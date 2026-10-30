const mongoose = require('mongoose');
const env = require('./env');

let transactionsSupported = false;

async function connectDB() {
  await mongoose.connect(env.mongoUri);

  // Multi-document transactions need a replica set (MongoDB Atlas, or a local
  // replica set). On a standalone server we fall back to guarded atomic
  // updates with rollback (see utils/transaction.js).
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch (err) {
    transactionsSupported = false;
  }

  console.log(
    `MongoDB connected (${mongoose.connection.name}). Transactions: ${
      transactionsSupported ? 'enabled' : 'standalone mode - using guarded updates with rollback'
    }`
  );
}

const supportsTransactions = () => transactionsSupported;

module.exports = { connectDB, supportsTransactions };
