const env = require('../config/env');
const Player = require('../models/Player');
const Counter = require('../models/Counter');
const Setting = require('../models/Setting');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { audit } = require('../utils/audit');
const { saveImage, deleteImage } = require('../middleware/upload');
const { CRICKET_STYLES, normalizeMobile, isValidMobile } = require('../utils/validators');

/** Public settings the registration page needs (no secrets). */
exports.getConfig = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      registrationOpen: await Setting.isRegistrationOpen(),
      tournamentName: env.payment.tournamentName,
      registrationFee: env.payment.fee,
      upiId: env.payment.upiId,
      payeeName: env.payment.payeeName,
      cricketStyles: CRICKET_STYLES,
    },
  });
});

const REGISTRATION_CLOSED_MESSAGE = 'Registration is disabled. Please contact the admin.';

const registrationStatus = (doc, open) => ({
  open,
  updatedAt: doc?.updatedAt || null,
  updatedBy: doc?.updatedBy || null,
});

/** GET /api/settings/registration - Admin */
exports.getRegistrationStatus = asyncHandler(async (req, res) => {
  const doc = await Setting.findById(Setting.KEYS.REGISTRATION_OPEN).populate('updatedBy', 'name username').lean();
  res.json({ success: true, data: registrationStatus(doc, doc ? doc.value !== false : true) });
});

/** PATCH /api/settings/registration  { open: true|false } - Admin */
exports.setRegistrationStatus = asyncHandler(async (req, res) => {
  if (typeof req.body.open !== 'boolean') throw new AppError('open must be true or false', 400);
  const doc = await Setting.setValue(Setting.KEYS.REGISTRATION_OPEN, req.body.open, req.user._id);
  audit(req, {
    category: 'settings',
    action: req.body.open ? 'settings.registration_opened' : 'settings.registration_closed',
    message: `${req.user.name} ${req.body.open ? 'opened' : 'closed'} player registration`,
    target: { type: 'Setting', id: Setting.KEYS.REGISTRATION_OPEN, label: 'Player registration' },
  });
  res.json({
    success: true,
    message: req.body.open ? 'Player registration is now open' : 'Player registration is now closed',
    data: registrationStatus(doc, req.body.open),
  });
});

const publicPlayer = (p) => ({
  _id: p._id,
  slNo: p.slNo,
  fullName: p.fullName,
  cricketStyle: p.cricketStyle,
  mobile: p.mobile,
  photoUrl: p.photoUrl,
  registrationDate: p.registrationDate,
  paymentStatus: p.paymentStatus,
});

exports.register = asyncHandler(async (req, res) => {
  if (!(await Setting.isRegistrationOpen())) {
    throw new AppError(REGISTRATION_CLOSED_MESSAGE, 403, { registrationClosed: true });
  }

  const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
  const cricketStyle = String(req.body.cricketStyle || '').trim();
  const mobile = normalizeMobile(req.body.mobile);

  const errors = {};
  if (fullName.length < 2) errors.fullName = 'Please enter your full name';
  else if (fullName.length > 100) errors.fullName = 'Name is too long';
  if (!CRICKET_STYLES.includes(cricketStyle)) errors.cricketStyle = 'Please choose your cricket style';
  if (!isValidMobile(mobile)) errors.mobile = 'Please enter a valid 10-digit mobile number';
  if (!req.file) errors.photo = 'Please add your photo';
  if (Object.keys(errors).length) {
    throw new AppError(Object.values(errors)[0], 400, errors);
  }

  const existing = await Player.findOne({ mobile }).select('slNo').lean();
  if (existing) {
    throw new AppError(`This mobile number is already registered (S.L. No ${existing.slNo})`, 409, {
      mobile: 'This mobile number is already registered',
    });
  }

  const photoUrl = await saveImage(req.file, 'players');
  const seq = await Counter.next('playerSlNo', env.playerId.start);

  try {
    const player = await Player.create({
      slNo: `${env.playerId.prefix}${seq}`,
      slSeq: seq,
      fullName,
      cricketStyle,
      mobile,
      photoUrl,
      paymentStatus: 'Unpaid',
      soldStatus: 'NotSold',
    });

    audit(req, {
      actor: { name: player.fullName, role: 'Player' },
      category: 'registration',
      action: 'registration.created',
      message: `${player.slNo} ${player.fullName} registered (${player.cricketStyle}, ${player.mobile})`,
      target: { type: 'Player', id: String(player._id), label: `${player.slNo} ${player.fullName}` },
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        player: publicPlayer(player),
        payment: {
          upiId: env.payment.upiId,
          payeeName: env.payment.payeeName,
          amount: env.payment.fee,
          tournamentName: env.payment.tournamentName,
        },
      },
    });
  } catch (err) {
    deleteImage(photoUrl);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.mobile) {
      throw new AppError('This mobile number is already registered', 409, {
        mobile: 'This mobile number is already registered',
      });
    }
    throw err;
  }
});
