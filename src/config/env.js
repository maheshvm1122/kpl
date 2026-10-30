const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const required = ['MONGODB_URI', 'JWT_SECRET'];
required.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
});

const env = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  seedAdmin: {
    name: process.env.SEED_ADMIN_NAME || 'Super Admin',
    username: process.env.SEED_ADMIN_USERNAME,
    password: process.env.SEED_ADMIN_PASSWORD,
    mobile: process.env.SEED_ADMIN_MOBILE || '',
    email: process.env.SEED_ADMIN_EMAIL || '',
  },

  payment: {
    upiId: process.env.UPI_ID || '',
    payeeName: process.env.UPI_PAYEE_NAME || '',
    fee: Number(process.env.REGISTRATION_FEE) || 500,
    tournamentName: process.env.TOURNAMENT_NAME || 'Cricket Tournament',
  },

  playerId: {
    prefix: process.env.PLAYER_ID_PREFIX || 'KPLS',
    start: Number(process.env.PLAYER_ID_START) || 2001,
  },

  uploadsDir: path.resolve(__dirname, '../../uploads'),
};

module.exports = env;
