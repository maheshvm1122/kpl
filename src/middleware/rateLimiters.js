const rateLimit = require('express-rate-limit');

const message = (text) => ({ success: false, message: text });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many login attempts. Please wait 15 minutes and try again'),
});

// Several players may register from one phone / Wi-Fi at the ground, so keep this generous.
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many registrations from this network. Please wait a few minutes and try again'),
});

module.exports = { loginLimiter, registrationLimiter };
