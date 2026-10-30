const AuditLog = require('../models/AuditLog');
const asyncHandler = require('../utils/asyncHandler');
const { assertObjectId, escapeRegex, parsePagination } = require('../utils/validators');

/**
 * GET /api/audit-logs - Admin only
 * Query: who = "" (all) | "registrations" | <userId>, category, search, from, to (YYYY-MM-DD), page, limit
 */
exports.list = asyncHandler(async (req, res) => {
  const { who, category, search, from, to } = req.query;
  const filter = {};

  if (who === 'registrations') filter.actorRole = 'Player';
  else if (who) {
    assertObjectId(who, 'user');
    filter.actor = who;
  }
  if (AuditLog.CATEGORIES.includes(category)) filter.category = category;
  if (search) {
    const term = escapeRegex(String(search).trim());
    filter.$or = [
      { message: { $regex: term, $options: 'i' } },
      { actorName: { $regex: term, $options: 'i' } },
      { 'target.label': { $regex: term, $options: 'i' } },
    ];
  }
  // Dates are interpreted in India time so "today" matches what the admin sees.
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00+05:30`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999+05:30`);
  }

  const { page, limit, skip } = parsePagination(req.query, 50);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
});
