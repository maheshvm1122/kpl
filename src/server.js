const fs = require('fs');
const env = require('./config/env');
const { connectDB } = require('./config/db');
const seedAdmin = require('./utils/seedAdmin');
const app = require('./app');

async function start() {
  fs.mkdirSync(env.uploadsDir, { recursive: true });
  await connectDB();
  await seedAdmin();

  app.listen(env.port, () => {
    console.log(`CricketBE API running on http://localhost:${env.port}/api`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
