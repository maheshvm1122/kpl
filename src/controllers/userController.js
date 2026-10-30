const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { audit, describeChanges } = require('../utils/audit');
const {
  ROLES,
  USER_STATUS,
  EMAIL_REGEX,
  normalizeMobile,
  isValidMobile,
  assertObjectId,
  escapeRegex,
} = require('../utils/validators');

const USERNAME_REGEX = /^[a-z0-9._-]{3,30}$/;
const MIN_PASSWORD = 6;

function readUserBody(body, { partial = false } = {}) {
  const data = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (name.length < 2) throw new AppError('Please enter the full name', 400);
    data.name = name;
  }
  if (body.mobile !== undefined && String(body.mobile).trim() !== '') {
    const mobile = normalizeMobile(body.mobile);
    if (!isValidMobile(mobile)) throw new AppError('Please enter a valid 10-digit mobile number', 400);
    data.mobile = mobile;
  } else if (body.mobile !== undefined) {
    data.mobile = '';
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (email && !EMAIL_REGEX.test(email)) throw new AppError('Please enter a valid email', 400);
    data.email = email;
  }
  if (!partial || body.username !== undefined) {
    const username = String(body.username || '').trim().toLowerCase();
    if (!USERNAME_REGEX.test(username)) {
      throw new AppError('Username must be 3-30 characters: letters, numbers, dot, dash or underscore', 400);
    }
    data.username = username;
  }
  if (!partial || body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw new AppError('Role must be Admin or Auctioneer', 400);
    data.role = body.role;
  }
  return data;
}

function assertPassword(password) {
  if (!password || String(password).length < MIN_PASSWORD) {
    throw new AppError(`Password must be at least ${MIN_PASSWORD} characters`, 400);
  }
}

async function assertUniqueUsername(username, excludeId) {
  const filter = { username };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await User.exists(filter)) throw new AppError('This username is already taken', 409);
}

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (USER_STATUS.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.search) {
    const term = escapeRegex(String(req.query.search).trim());
    filter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { username: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
      { mobile: { $regex: term } },
    ];
  }
  const users = await User.find(filter).sort({ createdAt: 1 });
  res.json({ success: true, data: users.map((u) => u.toJSON()) });
});

exports.create = asyncHandler(async (req, res) => {
  const data = readUserBody(req.body);
  assertPassword(req.body.password);
  await assertUniqueUsername(data.username);

  const user = new User({ ...data, status: 'Active' });
  await user.setPassword(String(req.body.password));
  await user.save();
  audit(req, {
    category: 'user',
    action: 'user.created',
    message: `${req.user.name} created ${user.role} user ${user.name} (@${user.username})`,
    target: { type: 'User', id: String(user._id), label: `${user.name} (@${user.username})` },
  });
  res.status(201).json({ success: true, message: 'User created', data: user.toJSON() });
});

exports.update = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'user id');
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  const data = readUserBody(req.body, { partial: true });
  if (data.username && data.username !== user.username) await assertUniqueUsername(data.username, user._id);

  if (data.role && data.role !== user.role && user._id.equals(req.user._id)) {
    throw new AppError('You cannot change your own role', 400);
  }
  if (data.role && data.role !== 'Admin' && user.role === 'Admin') {
    const otherAdmins = await User.countDocuments({ role: 'Admin', status: 'Active', _id: { $ne: user._id } });
    if (otherAdmins === 0) throw new AppError('At least one active admin is required', 400);
  }
  if (data.role && data.role !== user.role) user.tokenVersion += 1; // force re-login with new permissions

  const before = { name: user.name, username: user.username, email: user.email, mobile: user.mobile, role: user.role };
  Object.assign(user, data);
  await user.save();
  const changes = describeChanges(before, user);
  audit(req, {
    category: 'user',
    action: 'user.updated',
    message: `${req.user.name} edited user ${user.name}${changes.length ? ` (${changes.join(', ')})` : ''}`,
    target: { type: 'User', id: String(user._id), label: `${user.name} (@${user.username})` },
  });
  res.json({ success: true, message: 'User updated', data: user.toJSON() });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'user id');
  assertPassword(req.body.password);
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  await user.setPassword(String(req.body.password));
  if (!user._id.equals(req.user._id)) user.tokenVersion += 1; // log the user out everywhere
  await user.save();
  audit(req, {
    category: 'user',
    action: 'user.password_reset',
    message: `${req.user.name} reset the password of ${user.name} (@${user.username})`,
    target: { type: 'User', id: String(user._id), label: `${user.name} (@${user.username})` },
  });
  res.json({ success: true, message: `Password reset for ${user.username}` });
});

exports.updateStatus = asyncHandler(async (req, res) => {
  assertObjectId(req.params.id, 'user id');
  const { status } = req.body;
  if (!USER_STATUS.includes(status)) throw new AppError('Status must be Active or Inactive', 400);
  if (status === 'Inactive' && req.user._id.equals(req.params.id)) {
    throw new AppError('You cannot deactivate your own account', 400);
  }

  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);

  if (status === 'Inactive' && user.role === 'Admin') {
    const otherAdmins = await User.countDocuments({ role: 'Admin', status: 'Active', _id: { $ne: user._id } });
    if (otherAdmins === 0) throw new AppError('At least one active admin is required', 400);
  }

  if (user.status !== status) {
    user.status = status;
    if (status === 'Inactive') user.tokenVersion += 1; // existing tokens stop working immediately
    await user.save();
    audit(req, {
      category: 'user',
      action: status === 'Active' ? 'user.activated' : 'user.deactivated',
      message: `${req.user.name} ${status === 'Active' ? 'activated' : 'deactivated'} ${user.name} (@${user.username})`,
      target: { type: 'User', id: String(user._id), label: `${user.name} (@${user.username})` },
    });
  }
  res.json({
    success: true,
    message: `${user.username} ${status === 'Active' ? 'activated' : 'deactivated'}`,
    data: user.toJSON(),
  });
});
