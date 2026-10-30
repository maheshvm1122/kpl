const Player = require('../models/Player');
const PlayerPurchase = require('../models/PlayerPurchase');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { audit, playerLabel, describeChanges } = require('../utils/audit');
const { saveImage, deleteImage } = require('../middleware/upload');
const {
  CRICKET_STYLES,
  PAYMENT_STATUS,
  SOLD_STATUS,
  normalizeMobile,
  isValidMobile,
  assertObjectId,
  escapeRegex,
  parsePagination,
} = require('../utils/validators');

const SORT_FIELDS = {
  slNo: 'slSeq',
  name: 'fullName',
  registrationDate: 'registrationDate',
  soldAmount: 'soldAmount',
};

const TEAM_FIELDS = 'name logoUrl';

/** Builds the Mongo filter from query params. Auctioneers only ever see Paid players. */
function buildFilter(query, user) {
  const filter = {};

  if (query.search) {
    const term = escapeRegex(String(query.search).trim());
    filter.$or = [
      { slNo: { $regex: term, $options: 'i' } },
      { fullName: { $regex: term, $options: 'i' } },
      { mobile: { $regex: term } },
    ];
  }
  if (PAYMENT_STATUS.includes(query.paymentStatus)) filter.paymentStatus = query.paymentStatus;
  if (SOLD_STATUS.includes(query.soldStatus)) filter.soldStatus = query.soldStatus;
  if (CRICKET_STYLES.includes(query.cricketStyle)) filter.cricketStyle = query.cricketStyle;
  if (query.team) {
    assertObjectId(query.team, 'team');
    filter.team = query.team;
  }

  if (user.role === 'Auctioneer') filter.paymentStatus = 'Paid';
  return filter;
}

function buildSort(query) {
  const field = SORT_FIELDS[query.sortBy] || 'slSeq';
  const order = query.sortOrder === 'desc' ? -1 : 1;
  return field === 'slSeq' ? { slSeq: order } : { [field]: order, slSeq: 1 };
}

exports.list = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query, req.user);
  const { page, limit, skip } = parsePagination(req.query);

  const [items, total] = await Promise.all([
    Player.find(filter).sort(buildSort(req.query)).skip(skip).limit(limit).populate('team', TEAM_FIELDS).lean(),
    Player.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});

/** Ordered list of ids for the current filters - used by Previous / Next on the auction screen. */
exports.listIds = asyncHandler(async (req, res) => {
  const filter = buildFilter(req.query, req.user);
  const docs = await Player.find(filter).sort(buildSort(req.query)).select('_id').lean();
  res.json({ success: true, data: docs.map((d) => d._id) });
});

async function loadPlayerDetail(id, user) {
  assertObjectId(id, 'player id');
  const player = await Player.findById(id)
    .populate('team', 'name logoUrl totalPurse remainingPurse')
    .populate('paymentUpdatedBy', 'name username')
    .lean();
  if (!player) throw new AppError('Player not found', 404);
  if (user.role === 'Auctioneer' && player.paymentStatus !== 'Paid') {
    throw new AppError('Only paid players are available to the auctioneer', 403);
  }

  const purchases = await PlayerPurchase.find({ player: id })
    .sort({ purchaseDate: -1 })
    .populate('team', 'name')
    .populate('soldBy', 'name username')
    .populate('reversedBy', 'name username')
    .populate('editHistory.oldTeam', 'name')
    .populate('editHistory.newTeam', 'name')
    .populate('editHistory.editedBy', 'name username')
    .lean();

  return { ...player, purchases };
}

exports.getOne = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await loadPlayerDetail(req.params.id, req.user) });
});

/** Admin edit of registration details. Sale fields are never editable here. */
exports.update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'player id');
  const player = await Player.findById(req.params.id);
  if (!player) throw new AppError('Player not found', 404);
  const before = { fullName: player.fullName, cricketStyle: player.cricketStyle, mobile: player.mobile };

  if (req.body.fullName !== undefined) {
    const fullName = String(req.body.fullName).trim().replace(/\s+/g, ' ');
    if (fullName.length < 2) throw new AppError('Please enter the full name', 400);
    player.fullName = fullName;
  }
  if (req.body.cricketStyle !== undefined) {
    if (!CRICKET_STYLES.includes(req.body.cricketStyle)) throw new AppError('Invalid cricket style', 400);
    player.cricketStyle = req.body.cricketStyle;
  }
  if (req.body.mobile !== undefined) {
    const mobile = normalizeMobile(req.body.mobile);
    if (!isValidMobile(mobile)) throw new AppError('Please enter a valid 10-digit mobile number', 400);
    if (mobile !== player.mobile) {
      const taken = await Player.exists({ mobile, _id: { $ne: player._id } });
      if (taken) throw new AppError('This mobile number is already registered', 409);
      player.mobile = mobile;
    }
  }

  let oldPhoto = null;
  if (req.file) {
    oldPhoto = player.photoUrl;
    player.photoUrl = await saveImage(req.file, 'players');
  }

  await player.save();
  if (oldPhoto) deleteImage(oldPhoto);

  const changes = describeChanges(before, player);
  if (req.file) changes.push('photo changed');
  audit(req, {
    category: 'player',
    action: 'player.updated',
    message: `${req.user.name} edited ${playerLabel(player)}${changes.length ? ` (${changes.join(', ')})` : ''}`,
    target: { type: 'Player', id: String(player._id), label: playerLabel(player) },
    details: { before, after: { fullName: player.fullName, cricketStyle: player.cricketStyle, mobile: player.mobile } },
  });

  res.json({ success: true, message: 'Player updated', data: await loadPlayerDetail(player._id, req.user) });
});

exports.updatePayment = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'player id');
  const { status } = req.body;
  if (!PAYMENT_STATUS.includes(status)) throw new AppError('Status must be Paid or Unpaid', 400);

  const update = { paymentStatus: status, paymentUpdatedBy: req.user._id, paymentUpdatedAt: new Date() };
  // Guarded so a player cannot be marked Unpaid while (or after) being sold.
  const guard = status === 'Unpaid' ? { soldStatus: 'NotSold' } : {};
  const player = await Player.findOneAndUpdate({ _id: req.params.id, ...guard }, update, { new: true });

  if (!player) {
    const exists = await Player.findById(req.params.id).select('soldStatus slNo').lean();
    if (!exists) throw new AppError('Player not found', 404);
    throw new AppError(
      `${exists.slNo} is already sold. The auctioneer must undo the sale before marking this player Unpaid`,
      409
    );
  }

  audit(req, {
    category: 'payment',
    action: status === 'Paid' ? 'payment.paid' : 'payment.unpaid',
    message: `${req.user.name} marked ${playerLabel(player)} as ${status}`,
    target: { type: 'Player', id: String(player._id), label: playerLabel(player) },
  });

  res.json({
    success: true,
    message: `${player.slNo} marked ${status}`,
    data: await loadPlayerDetail(player._id, req.user),
  });
});

exports.bulkUpdatePayment = asyncHandler(async (req, res) => {
  const { ids, status = 'Paid' } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError('Select at least one player', 400);
  if (!PAYMENT_STATUS.includes(status)) throw new AppError('Status must be Paid or Unpaid', 400);
  ids.forEach((id) => assertObjectId(id, 'player id'));

  const filter = { _id: { $in: ids }, paymentStatus: { $ne: status } };
  if (status === 'Unpaid') filter.soldStatus = 'NotSold';

  const targets = await Player.find(filter).select('slNo fullName').lean();
  const result = await Player.updateMany(
    { ...filter, _id: { $in: targets.map((p) => p._id) } },
    { paymentStatus: status, paymentUpdatedBy: req.user._id, paymentUpdatedAt: new Date() }
  );
  if (targets.length) {
    audit(req, {
      category: 'payment',
      action: status === 'Paid' ? 'payment.bulk_paid' : 'payment.bulk_unpaid',
      message: `${req.user.name} marked ${targets.length} player(s) as ${status}: ${targets.map((p) => p.slNo).join(', ')}`,
      details: { players: targets.map(playerLabel) },
    });
  }

  const updated = result.modifiedCount;
  const skipped = ids.length - updated;
  res.json({
    success: true,
    message: `${updated} player(s) marked ${status}${skipped ? `, ${skipped} skipped` : ''}`,
    data: { updated, skipped },
  });
});
