const mongoose = require('mongoose');
const { CRICKET_STYLES, PAYMENT_STATUS, SOLD_STATUS } = require('../utils/validators');

const playerSchema = new mongoose.Schema(
  {
    slNo: { type: String, required: true, unique: true, trim: true },
    slSeq: { type: Number, required: true }, // numeric part, used for correct sorting
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    cricketStyle: { type: String, required: true, enum: CRICKET_STYLES },
    mobile: { type: String, required: true, unique: true, trim: true },
    photoUrl: { type: String, required: true },
    registrationDate: { type: Date, default: Date.now },

    paymentStatus: { type: String, enum: PAYMENT_STATUS, default: 'Unpaid' },
    paymentUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paymentUpdatedAt: { type: Date, default: null },

    soldStatus: { type: String, enum: SOLD_STATUS, default: 'NotSold' },
    soldAmount: { type: Number, default: null },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    soldAt: { type: Date, default: null },
  },
  { timestamps: true }
);

playerSchema.index({ paymentStatus: 1 });
playerSchema.index({ soldStatus: 1 });
playerSchema.index({ team: 1 });
playerSchema.index({ slSeq: 1 });
playerSchema.index({ registrationDate: -1 });

module.exports = mongoose.model('Player', playerSchema);
