const mongoose = require('mongoose');
const { supportsTransactions } = require('../config/db');

/**
 * Runs `work(session, onRollback)` atomically.
 *
 * - On a replica set / Atlas: uses a real MongoDB transaction; `onRollback` is a no-op.
 * - On a standalone server: runs without a session. Each step registers an undo
 *   function through `onRollback`; if a later step fails, the undo steps run in
 *   reverse order. All steps use conditional updates, so concurrent requests
 *   (e.g. two Sell clicks) can never both succeed.
 */
async function runAtomic(work) {
  if (supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work(session, () => {});
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  const undoSteps = [];
  const onRollback = (fn) => undoSteps.push(fn);
  try {
    return await work(null, onRollback);
  } catch (err) {
    for (const undo of undoSteps.reverse()) {
      try {
        await undo();
      } catch (undoErr) {
        console.error('Rollback step failed:', undoErr);
      }
    }
    throw err;
  }
}

module.exports = { runAtomic };
