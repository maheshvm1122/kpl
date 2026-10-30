const mongoose = require('mongoose');

const { ObjectId } = mongoose.Schema.Types;

const editSchema = new mongoose.Schema(
  {
    oldTeam: { type: ObjectId, ref: 'Team' },
    oldAmount: Number,
    newTeam: { type: ObjectId, ref: 'Team' },
    newAmount: Number,
    editedBy: { type: ObjectId, ref: 'User' },
    editedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const playerPurchaseSchema = new mongoose.Schema(
  {
    player: { type: ObjectId, ref: 'Player', required: true },
    team: { type: ObjectId, ref: 'Team', required: true },
    soldAmount: { type: Number, required: true, min: 1 },
    soldBy: { type: ObjectId, ref: 'User', required: true },
    purchaseDate: { type: Date, default: Date.now },
    editHistory: { type: [editSchema], default: [] },
    reversed: { type: Boolean, default: false },
    reversedBy: { type: ObjectId, ref: 'User', default: null },
    reversedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

playerPurchaseSchema.index({ player: 1, reversed: 1 });
playerPurchaseSchema.index({ team: 1, reversed: 1 });

module.exports = mongoose.model('PlayerPurchase', playerPurchaseSchema);
