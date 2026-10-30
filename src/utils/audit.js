const AuditLog = require('../models/AuditLog');

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const playerLabel = (p) => (p ? `${p.slNo} ${p.fullName}` : '');

/**
 * Records an action in the audit log. Never throws: a logging problem must not
 * break the action itself.
 *
 *   audit(req, { category: 'payment', action: 'payment.paid', message: '...', target: {...}, details: {...} })
 *
 * The actor is taken from req.user (logged-in Admin / Auctioneer) unless `actor` is passed
 * (e.g. { name, role: 'Player' } for public registrations).
 */
function audit(req, { category, action, message, target, details, actor }) {
  const user = req?.user;
  const entry = {
    actor: actor ? actor.id || null : user?._id || null,
    actorName: actor ? actor.name : user?.name || '',
    actorRole: actor ? actor.role : user?.role || 'Unknown',
    category,
    action,
    message,
    target: target || {},
    details: details || null,
    ip: req?.ip || '',
  };
  AuditLog.create(entry).catch((err) => console.error('Audit log failed:', err.message));
}

const FIELD_LABELS = {
  fullName: 'name',
  cricketStyle: 'style',
  mobile: 'mobile',
  name: 'name',
  ownerName: 'owner',
  ownerMobile: 'owner mobile',
  totalPurse: 'purse',
  username: 'username',
  email: 'email',
  role: 'role',
};
const MONEY_FIELDS = ['totalPurse'];

/** "purse ₹80,000 → ₹90,000, owner "Ravi" → "Ravi K"" for the fields that changed. */
function describeChanges(before, after) {
  const show = (key, value) => (MONEY_FIELDS.includes(key) ? rupees(value) : `"${value || ''}"`);
  return Object.keys(before)
    .filter((key) => before[key] !== after[key])
    .map((key) => `${FIELD_LABELS[key] || key} ${show(key, before[key])} → ${show(key, after[key])}`);
}

module.exports = { audit, rupees, playerLabel, describeChanges };
