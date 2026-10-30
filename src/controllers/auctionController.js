const Player = require('../models/Player');
const Team = require('../models/Team');
const PlayerPurchase = require('../models/PlayerPurchase');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { runAtomic } = require('../utils/transaction');
const { audit, playerLabel } = require('../utils/audit');
const { assertObjectId, toPositiveAmount, parsePagination } = require('../utils/validators');

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const withSession = (session) => (session ? { session, new: true } : { new: true });
const createOpts = (session) => (session ? { session } : undefined);

const PLAYER_TEAM_FIELDS = 'name logoUrl totalPurse remainingPurse';

async function loadTeamOrFail(teamId) {
  assertObjectId(teamId, 'team');
  const team = await Team.findById(teamId).lean();
  if (!team) throw new AppError('Please choose a valid team', 400);
  return team;
}

/** Deducts `amount` from a team only if it has enough purse left. */
async function deductPurse(teamId, amount, session, onRollback) {
  const team = await Team.findOneAndUpdate(
    { _id: teamId, remainingPurse: { $gte: amount } },
    { $inc: { remainingPurse: -amount } },
    withSession(session)
  );
  if (!team) {
    const current = await Team.findById(teamId).select('name remainingPurse').lean();
    throw new AppError(
      current
        ? `${current.name} has only ${rupees(current.remainingPurse)} remaining. Amount ${rupees(amount)} is too high`
        : 'Team not found',
      400
    );
  }
  onRollback(() => Team.updateOne({ _id: teamId }, { $inc: { remainingPurse: amount } }));
  return team;
}

async function refundPurse(teamId, amount, session, onRollback) {
  const team = await Team.findOneAndUpdate(
    { _id: teamId },
    { $inc: { remainingPurse: amount } },
    withSession(session)
  );
  if (!team) throw new AppError('Team not found', 404);
  onRollback(() => Team.updateOne({ _id: teamId }, { $inc: { remainingPurse: -amount } }));
  return team;
}

async function playerResponse(playerId) {
  return Player.findById(playerId).populate('team', PLAYER_TEAM_FIELDS).lean();
}

/** POST /api/auction/sell  { playerId, teamId, amount } - Auctioneer only */
exports.sell = asyncHandler(async (req, res) => {
  const { playerId, teamId } = req.body;
  assertObjectId(playerId, 'player');
  const amount = toPositiveAmount(req.body.amount, 'Sold amount');

  const existing = await Player.findById(playerId).select('slNo fullName paymentStatus soldStatus').lean();
  if (!existing) throw new AppError('Player not found', 404);
  if (existing.paymentStatus !== 'Paid') throw new AppError(`${existing.slNo} has not paid and cannot be sold`, 400);
  if (existing.soldStatus === 'Sold') throw new AppError(`${existing.slNo} is already sold`, 409);
  await loadTeamOrFail(teamId);

  const result = await runAtomic(async (session, onRollback) => {
    const soldAt = new Date();

    // Conditional update: only one request can move this player from NotSold to Sold.
    const player = await Player.findOneAndUpdate(
      { _id: playerId, paymentStatus: 'Paid', soldStatus: 'NotSold' },
      { soldStatus: 'Sold', team: teamId, soldAmount: amount, soldAt },
      withSession(session)
    );
    if (!player) throw new AppError(`${existing.slNo} was just sold or is no longer available`, 409);
    onRollback(() =>
      Player.updateOne(
        { _id: playerId, soldStatus: 'Sold', soldAt },
        { soldStatus: 'NotSold', team: null, soldAmount: null, soldAt: null }
      )
    );

    const team = await deductPurse(teamId, amount, session, onRollback);

    const [purchase] = await PlayerPurchase.create(
      [{ player: playerId, team: teamId, soldAmount: amount, soldBy: req.user._id, purchaseDate: soldAt }],
      createOpts(session)
    );

    return { team, purchase };
  });

  audit(req, {
    category: 'auction',
    action: 'auction.sell',
    message: `${req.user.name} sold ${playerLabel(existing)} to ${result.team.name} for ${rupees(amount)}`,
    target: { type: 'Player', id: String(playerId), label: playerLabel(existing) },
    details: { team: result.team.name, amount },
  });

  res.status(201).json({
    success: true,
    message: `SOLD! ${existing.slNo} ${existing.fullName} to ${result.team.name} for ${rupees(amount)}`,
    data: { player: await playerResponse(playerId), team: result.team, purchase: result.purchase },
  });
});

/** PUT /api/auction/sales/:playerId  { teamId, amount } - Auctioneer only */
exports.editSale = asyncHandler(async (req, res) => {
  const { playerId } = req.params;
  assertObjectId(playerId, 'player');
  const newTeamId = req.body.teamId;
  const newAmount = toPositiveAmount(req.body.amount, 'Sold amount');
  const newTeam = await loadTeamOrFail(newTeamId);

  const player = await Player.findById(playerId).lean();
  if (!player) throw new AppError('Player not found', 404);
  if (player.soldStatus !== 'Sold') throw new AppError(`${player.slNo} is not sold yet`, 400);

  const purchase = await PlayerPurchase.findOne({ player: playerId, reversed: false }).sort({ purchaseDate: -1 });
  if (!purchase) throw new AppError('Sale record not found for this player', 404);

  const oldTeamId = player.team;
  const oldAmount = player.soldAmount;
  const sameTeam = String(oldTeamId) === String(newTeamId);
  if (sameTeam && oldAmount === newAmount) throw new AppError('Nothing changed', 400);

  await runAtomic(async (session, onRollback) => {
    const updated = await Player.findOneAndUpdate(
      { _id: playerId, soldStatus: 'Sold', team: oldTeamId, soldAmount: oldAmount },
      { team: newTeamId, soldAmount: newAmount },
      withSession(session)
    );
    if (!updated) throw new AppError('This sale was just changed by someone else. Please reload and try again', 409);
    onRollback(() =>
      Player.updateOne(
        { _id: playerId, team: newTeamId, soldAmount: newAmount },
        { team: oldTeamId, soldAmount: oldAmount }
      )
    );

    if (sameTeam) {
      const diff = newAmount - oldAmount;
      if (diff > 0) await deductPurse(newTeamId, diff, session, onRollback);
      else await refundPurse(newTeamId, -diff, session, onRollback);
    } else {
      await refundPurse(oldTeamId, oldAmount, session, onRollback);
      await deductPurse(newTeamId, newAmount, session, onRollback);
    }

    const editEntry = {
      oldTeam: oldTeamId,
      oldAmount,
      newTeam: newTeamId,
      newAmount,
      editedBy: req.user._id,
      editedAt: new Date(),
    };
    const updatedPurchase = await PlayerPurchase.findOneAndUpdate(
      { _id: purchase._id, reversed: false },
      { team: newTeamId, soldAmount: newAmount, $push: { editHistory: editEntry } },
      withSession(session)
    );
    if (!updatedPurchase) throw new AppError('Sale record changed. Please reload and try again', 409);
  });

  const oldTeam = await Team.findById(oldTeamId).select('name').lean();
  audit(req, {
    category: 'auction',
    action: 'auction.edit_sale',
    message: `${req.user.name} changed the sale of ${playerLabel(player)}: ${oldTeam?.name} ${rupees(oldAmount)} → ${newTeam.name} ${rupees(newAmount)}`,
    target: { type: 'Player', id: String(playerId), label: playerLabel(player) },
    details: { oldTeam: oldTeam?.name, oldAmount, newTeam: newTeam.name, newAmount },
  });

  res.json({
    success: true,
    message: `Sale updated for ${player.slNo}`,
    data: { player: await playerResponse(playerId) },
  });
});

/** POST /api/auction/sales/:playerId/undo - Auctioneer only */
exports.undoSale = asyncHandler(async (req, res) => {
  const { playerId } = req.params;
  assertObjectId(playerId, 'player');

  const player = await Player.findById(playerId).lean();
  if (!player) throw new AppError('Player not found', 404);
  if (player.soldStatus !== 'Sold') throw new AppError(`${player.slNo} is not sold`, 400);

  const purchase = await PlayerPurchase.findOne({ player: playerId, reversed: false }).sort({ purchaseDate: -1 });

  await runAtomic(async (session, onRollback) => {
    const updated = await Player.findOneAndUpdate(
      { _id: playerId, soldStatus: 'Sold', team: player.team, soldAmount: player.soldAmount },
      { soldStatus: 'NotSold', team: null, soldAmount: null, soldAt: null },
      withSession(session)
    );
    if (!updated) throw new AppError('This sale was just changed by someone else. Please reload and try again', 409);
    onRollback(() =>
      Player.updateOne(
        { _id: playerId, soldStatus: 'NotSold' },
        { soldStatus: 'Sold', team: player.team, soldAmount: player.soldAmount, soldAt: player.soldAt }
      )
    );

    await refundPurse(player.team, player.soldAmount, session, onRollback);

    if (purchase) {
      await PlayerPurchase.findOneAndUpdate(
        { _id: purchase._id, reversed: false },
        { reversed: true, reversedBy: req.user._id, reversedAt: new Date() },
        withSession(session)
      );
    }
  });

  const undoneTeam = await Team.findById(player.team).select('name').lean();
  audit(req, {
    category: 'auction',
    action: 'auction.undo_sale',
    message: `${req.user.name} undid the sale of ${playerLabel(player)} (${undoneTeam?.name}, ${rupees(player.soldAmount)} returned)`,
    target: { type: 'Player', id: String(playerId), label: playerLabel(player) },
  });

  res.json({
    success: true,
    message: `Sale undone. ${player.slNo} is back in the auction and ${rupees(player.soldAmount)} returned to the team`,
    data: { player: await playerResponse(playerId) },
  });
});

/** GET /api/auction/purchases - sale history (Admin & Auctioneer, read-only) */
exports.purchases = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, 50);
  const filter = {};
  if (req.query.team) {
    assertObjectId(req.query.team, 'team');
    filter.team = req.query.team;
  }
  if (req.query.reversed === 'true') filter.reversed = true;
  if (req.query.reversed === 'false') filter.reversed = false;

  const [items, total] = await Promise.all([
    PlayerPurchase.find(filter)
      .sort({ purchaseDate: -1 })
      .skip(skip)
      .limit(limit)
      .populate('player', 'slNo fullName cricketStyle photoUrl')
      .populate('team', 'name')
      .populate('soldBy', 'name username')
      .lean(),
    PlayerPurchase.countDocuments(filter),
  ]);
  res.json({ success: true, data: { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } });
});
