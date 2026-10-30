const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { loginLimiter, registrationLimiter } = require('../middleware/rateLimiters');

const auth = require('../controllers/authController');
const pub = require('../controllers/publicController');
const players = require('../controllers/playerController');
const teams = require('../controllers/teamController');
const users = require('../controllers/userController');
const auction = require('../controllers/auctionController');
const dashboard = require('../controllers/dashboardController');
const auditLogs = require('../controllers/auditController');

const router = express.Router();

const ADMIN = 'Admin';
const AUCTIONEER = 'Auctioneer';
const staff = [authenticate, authorize(ADMIN, AUCTIONEER)];
const adminOnly = [authenticate, authorize(ADMIN)];
const auctioneerOnly = [authenticate, authorize(AUCTIONEER)];

router.get('/health', (req, res) => res.json({ success: true, status: 'ok' }));

// Public (no login)
router.get('/public/config', pub.getConfig);
router.post('/public/register', registrationLimiter, upload.single('photo'), pub.register);

// Settings (Admin) - open / close player registration
router.get('/settings/registration', ...adminOnly, pub.getRegistrationStatus);
router.patch('/settings/registration', ...adminOnly, pub.setRegistrationStatus);

// Audit logs (Admin only)
router.get('/audit-logs', ...adminOnly, auditLogs.list);

// Auth
router.post('/auth/login', loginLimiter, auth.login);
router.get('/auth/me', authenticate, auth.me);

// Dashboard
router.get('/dashboard', ...staff, dashboard.summary);

// Players (Auctioneer only sees Paid players - enforced in the controller)
router.get('/players', ...staff, players.list);
router.get('/players/ids', ...staff, players.listIds);
router.patch('/players/payment/bulk', ...adminOnly, players.bulkUpdatePayment);
router.get('/players/:id', ...staff, players.getOne);
router.put('/players/:id', ...adminOnly, upload.single('photo'), players.update);
router.patch('/players/:id/payment', ...adminOnly, players.updatePayment);

// Teams
router.get('/teams', ...staff, teams.list);
router.get('/teams/stats', ...staff, teams.stats);
router.get('/teams/:id', ...staff, teams.getOne);
router.post('/teams', ...adminOnly, upload.single('logo'), teams.create);
router.put('/teams/:id', ...adminOnly, upload.single('logo'), teams.update);
router.delete('/teams/:id', ...adminOnly, teams.remove);

// Users (Admin only)
router.get('/users', ...adminOnly, users.list);
router.post('/users', ...adminOnly, users.create);
router.put('/users/:id', ...adminOnly, users.update);
router.patch('/users/:id/password', ...adminOnly, users.resetPassword);
router.patch('/users/:id/status', ...adminOnly, users.updateStatus);

// Auction - selling, editing and undoing a sale is Auctioneer-only (Admin gets 403)
router.post('/auction/sell', ...auctioneerOnly, auction.sell);
router.put('/auction/sales/:playerId', ...auctioneerOnly, auction.editSale);
router.post('/auction/sales/:playerId/undo', ...auctioneerOnly, auction.undoSale);
router.get('/auction/purchases', ...staff, auction.purchases);

module.exports = router;
