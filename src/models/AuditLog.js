const mongoose = require('mongoose');

const AUDIT_CATEGORIES = ['auth', 'registration', 'payment', 'player', 'team', 'user', 'auction', 'settings'];

/** One record per action: who did what, to what, and when. */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null for public registrations
    actorName: { type: String, default: '' },
    actorRole: { type: String, enum: ['Admin', 'Auctioneer', 'Player', 'Unknown'], default: 'Unknown' },
    category: { type: String, enum: AUDIT_CATEGORIES, required: true },
    action: { type: String, required: true }, // e.g. "payment.paid", "auction.sell"
    message: { type: String, required: true }, // readable sentence shown in the UI
    target: {
      type: { type: String, default: '' }, // Player | Team | User | Setting
      id: { type: String, default: '' },
      label: { type: String, default: '' }, // e.g. "KPLS2001 Ramesh"
    },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ actorRole: 1, createdAt: -1 });
auditLogSchema.index({ category: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
AuditLog.CATEGORIES = AUDIT_CATEGORIES;

module.exports = AuditLog;
