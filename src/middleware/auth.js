const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

const signToken = (user) =>
  jwt.sign({ sub: user._id.toString(), role: user.role, v: user.tokenVersion }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

/** Verifies the JWT and loads the user. Inactive users and stale tokens are rejected. */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError('Please log in to continue', 401);

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (err) {
    throw new AppError('Your session has expired. Please log in again', 401);
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'Active' || user.tokenVersion !== payload.v) {
    throw new AppError('Your session is no longer valid. Please log in again', 401);
  }

  req.user = user;
  next();
});

/** Allows only the listed roles. Always use after `authenticate`. */
const authorize =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to do this', 403));
    }
    return next();
  };

module.exports = { signToken, authenticate, authorize };
