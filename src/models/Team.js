const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameKey: { type: String, required: true, unique: true }, // lower-cased name for case-insensitive uniqueness
    ownerName: { type: String, trim: true, default: '' },
    ownerMobile: { type: String, trim: true, default: '' },
    logoUrl: { type: String, default: '' },
    totalPurse: { type: Number, required: true, min: 0 },
    remainingPurse: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

teamSchema.pre('validate', function setNameKey(next) {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
  next();
});

teamSchema.virtual('spentAmount').get(function spent() {
  return this.totalPurse - this.remainingPurse;
});

teamSchema.set('toJSON', { virtuals: true });
teamSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Team', teamSchema);
