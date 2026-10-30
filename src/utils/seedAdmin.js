const env = require('../config/env');
const User = require('../models/User');

/** Creates the first admin from .env when no admin exists yet. */
async function seedAdmin() {
  const adminExists = await User.exists({ role: 'Admin' });
  if (adminExists) return;

  const { name, username, password, mobile, email } = env.seedAdmin;
  if (!username || !password) {
    console.warn('No admin user exists. Set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD in .env and restart.');
    return;
  }

  const user = new User({
    name,
    username: username.toLowerCase(),
    mobile,
    email,
    role: 'Admin',
    status: 'Active',
  });
  await user.setPassword(password);
  await user.save();
  console.log(`Seeded first admin user "${user.username}". Change the password after first login.`);
}

module.exports = seedAdmin;
