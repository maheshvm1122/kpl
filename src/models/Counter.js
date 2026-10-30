const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true },
});

const Counter = mongoose.model('Counter', counterSchema);

/**
 * Atomically returns the next number in a sequence.
 * The first call returns `start`, then start+1, start+2, ...
 */
Counter.next = async function next(name, start) {
  // Ensure the counter exists without racing: only inserts when missing.
  await Counter.updateOne({ _id: name }, { $setOnInsert: { seq: start - 1 } }, { upsert: true }).catch((err) => {
    if (err.code !== 11000) throw err; // another request created it first
  });
  const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true });
  return doc.seq;
};

module.exports = Counter;
