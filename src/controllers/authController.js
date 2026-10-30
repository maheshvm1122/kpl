const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { signToken } = require('../middleware/auth');

exports.login = asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!username || !password) throw new AppError('Please enter username and password', 400);

  const user = await User.findOne({ username }).select('+passwordHash');
  if (!user || !(await user.checkPassword(password))) {
    audit(req, {
      actor: user ? { id: user._id, name: user.name, role: user.role } : { name: username, role: 'Unknown' },
      category: 'auth',
      action: 'auth.login_failed',
      message: `Failed login attempt for username "${username}"`,
    });
    throw new AppError('Incorrect username or password', 401);
  }
  if (user.status !== 'Active') {
    audit(req, {
      actor: { id: user._id, name: user.name, role: user.role },
      category: 'auth',
      action: 'auth.login_blocked',
      message: `${user.name} tried to log in but the account is deactivated`,
    });
    throw new AppError('Your account has been deactivated. Please contact the admin', 403);
  }

  audit(req, {
    actor: { id: user._id, name: user.name, role: user.role },
    category: 'auth',
    action: 'auth.login',
    message: `${user.name} logged in`,
  });

  res.json({ success: true, data: { token: signToken(user), user: user.toJSON() } });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.user.toJSON() });
});
