const Team = require('../models/Team');
const Player = require('../models/Player');
const PlayerPurchase = require('../models/PlayerPurchase');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { saveImage, deleteImage } = require('../middleware/upload');
const { audit, rupees, describeChanges } = require('../utils/audit');
const { normalizeMobile, isValidMobile, assertObjectId, escapeRegex } = require('../utils/validators');

/** Sum of active (not reversed) purchases for a team - the source of truth for "spent". */
async function spentByTeam(teamId) {
  const [row] = await PlayerPurchase.aggregate([
    { $match: { team: teamId, reversed: false } },
    { $group: { _id: null, total: { $sum: '$soldAmount' } } },
  ]);
  return row ? row.total : 0;
}

function readTeamBody(body, { partial = false } = {}) {
  const data = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2) throw new AppError('Please enter the team name', 400);
    data.name = name;
  }
  if (body.ownerName !== undefined) data.ownerName = String(body.ownerName).trim();
  if (body.ownerMobile !== undefined && String(body.ownerMobile).trim() !== '') {
    const mobile = normalizeMobile(body.ownerMobile);
    if (!isValidMobile(mobile)) throw new AppError('Please enter a valid 10-digit owner mobile number', 400);
    data.ownerMobile = mobile;
  } else if (body.ownerMobile !== undefined) {
    data.ownerMobile = '';
  }
  if (!partial || body.totalPurse !== undefined) {
    const purse = Number(body.totalPurse);
    if (!Number.isFinite(purse) || purse <= 0) throw new AppError('Initial purse must be greater than 0', 400);
    data.totalPurse = Math.round(purse);
  }
  return data;
}

async function assertUniqueName(name, excludeId) {
  const filter = { nameKey: name.toLowerCase() };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await Team.exists(filter)) throw new AppError('A team with this name already exists', 409);
}

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.search) filter.name = { $regex: escapeRegex(String(req.query.search).trim()), $options: 'i' };

  const teams = await Team.find(filter).sort({ name: 1 }).lean();
  const counts = await Player.aggregate([
    { $match: { soldStatus: 'Sold' } },
    { $group: { _id: '$team', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));

  res.json({
    success: true,
    data: teams.map((t) => ({
      ...t,
      spentAmount: t.totalPurse - t.remainingPurse,
      playersCount: countMap[String(t._id)] || 0,
    })),
  });
});

exports.getOne = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'team id');
  const team = await Team.findById(req.params.id).lean();
  if (!team) throw new AppError('Team not found', 404);
  const players = await Player.find({ team: team._id, soldStatus: 'Sold' })
    .select('slNo fullName cricketStyle photoUrl soldAmount soldAt')
    .sort({ soldAt: 1 })
    .lean();
  res.json({
    success: true,
    data: { ...team, spentAmount: team.totalPurse - team.remainingPurse, playersCount: players.length, players },
  });
});

exports.create = asyncHandler(async (req, res) => {
  const data = readTeamBody(req.body);
  await assertUniqueName(data.name);
  if (req.file) data.logoUrl = await saveImage(req.file, 'teams', 600);

  const team = await Team.create({ ...data, remainingPurse: data.totalPurse });
  audit(req, {
    category: 'team',
    action: 'team.created',
    message: `${req.user.name} created team ${team.name} (purse ${rupees(team.totalPurse)})`,
    target: { type: 'Team', id: String(team._id), label: team.name },
  });
  res.status(201).json({ success: true, message: 'Team created', data: team });
});

exports.update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'team id');
  const team = await Team.findById(req.params.id);
  if (!team) throw new AppError('Team not found', 404);

  const data = readTeamBody(req.body, { partial: true });
  if (data.name) await assertUniqueName(data.name, team._id);
  const before = { name: team.name, ownerName: team.ownerName, ownerMobile: team.ownerMobile, totalPurse: team.totalPurse };

  if (data.totalPurse !== undefined && data.totalPurse !== team.totalPurse) {
    const spent = await spentByTeam(team._id);
    if (data.totalPurse < spent) {
      throw new AppError(
        `Initial purse cannot be less than the amount already spent (₹${spent.toLocaleString('en-IN')})`,
        400
      );
    }
    // Guarded update so a sale happening at the same moment cannot be lost.
    const updated = await Team.findOneAndUpdate(
      { _id: team._id, remainingPurse: team.remainingPurse },
      { totalPurse: data.totalPurse, remainingPurse: data.totalPurse - spent },
      { new: true }
    );
    if (!updated) throw new AppError('This team was just updated by a sale. Please try again', 409);
    team.totalPurse = updated.totalPurse;
    team.remainingPurse = updated.remainingPurse;
    delete data.totalPurse;
  }

  Object.assign(team, data);
  let oldLogo = null;
  if (req.file) {
    oldLogo = team.logoUrl;
    team.logoUrl = await saveImage(req.file, 'teams', 600);
  }
  await team.save();
  if (oldLogo) deleteImage(oldLogo);

  const changes = describeChanges(before, team);
  if (req.file) changes.push('logo changed');
  audit(req, {
    category: 'team',
    action: 'team.updated',
    message: `${req.user.name} edited team ${team.name}${changes.length ? ` (${changes.join(', ')})` : ''}`,
    target: { type: 'Team', id: String(team._id), label: team.name },
  });

  res.json({ success: true, message: 'Team updated', data: team });
});

exports.remove = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'team id');
  const team = await Team.findById(req.params.id);
  if (!team) throw new AppError('Team not found', 404);

  const hasPlayers = await Player.exists({ team: team._id, soldStatus: 'Sold' });
  if (hasPlayers) throw new AppError('This team has purchased players and cannot be deleted', 409);

  await team.deleteOne();
  audit(req, {
    category: 'team',
    action: 'team.deleted',
    message: `${req.user.name} deleted team ${team.name}`,
    target: { type: 'Team', id: String(team._id), label: team.name },
  });
  deleteImage(team.logoUrl);
  res.json({ success: true, message: 'Team deleted' });
});

const STATS_SORT = {
  remainingPurse: (a, b) => b.remainingPurse - a.remainingPurse,
  playersCount: (a, b) => b.playersCount - a.playersCount,
  spentAmount: (a, b) => b.spentAmount - a.spentAmount,
  name: (a, b) => a.name.localeCompare(b.name),
};

/** Team statistics cards: every team with its purchased players. */
exports.stats = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.search) filter.name = { $regex: escapeRegex(String(req.query.search).trim()), $options: 'i' };

  const teams = await Team.find(filter).lean();
  const players = await Player.find({ soldStatus: 'Sold', team: { $in: teams.map((t) => t._id) } })
    .select('slNo fullName cricketStyle photoUrl soldAmount soldAt team')
    .sort({ soldAt: 1 })
    .lean();

  const byTeam = {};
  players.forEach((p) => {
    const key = String(p.team);
    (byTeam[key] = byTeam[key] || []).push(p);
  });

  const data = teams.map((t) => {
    const list = byTeam[String(t._id)] || [];
    return {
      ...t,
      spentAmount: t.totalPurse - t.remainingPurse,
      playersCount: list.length,
      players: list,
    };
  });

  const sorter = STATS_SORT[req.query.sortBy] || STATS_SORT.name;
  data.sort(sorter);
  if (req.query.sortOrder === 'asc' && req.query.sortBy && req.query.sortBy !== 'name') data.reverse();

  res.json({ success: true, data });
});
