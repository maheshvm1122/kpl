# CricketBE – Cricket Auction API

Node.js + Express + MongoDB (Mongoose) API for player registration, payment verification, teams, users and the live player auction.

## Setup

```bash
cd CricketBE
npm install
cp .env.example .env      # then edit .env (skip if .env already exists)
npm run dev               # or: npm start
```

The API runs at `http://localhost:5000/api`. Uploaded photos are stored in `CricketBE/uploads/` and served at `/uploads/...`.

### First admin
On first start, if no Admin exists, one is created from `SEED_ADMIN_*` in `.env`. Log in with that username and password, then create more Admin / Auctioneer users from **Users**.

### MongoDB
- Local MongoDB works as-is (`mongodb://127.0.0.1:27017/cricket_auction`).
- On a replica set (MongoDB Atlas, or a local replica set) selling / editing / undoing a sale runs inside a real MongoDB transaction.
- On a standalone server the same operations use guarded conditional updates with automatic rollback, so a player can never be sold twice and a purse can never go below zero. The startup log tells you which mode is active.

## Environment (`.env`)

| Key | Purpose |
|---|---|
| `PORT` | API port (default 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random secret for login tokens |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `12h` |
| `CLIENT_URL` | Frontend URL(s) allowed by CORS, comma separated |
| `SEED_ADMIN_*` | First admin, created once |
| `UPI_ID`, `UPI_PAYEE_NAME` | Personal UPI ID that receives the fee |
| `REGISTRATION_FEE` | Exact fee in ₹ |
| `TOURNAMENT_NAME` | Shown on the registration page |
| `PLAYER_ID_PREFIX`, `PLAYER_ID_START` | S.L. No format, e.g. `KPLS` + `2001` → KPLS2001 |

## Structure

```
src/
  config/       env + MongoDB connection
  models/       Player, Team, User, PlayerPurchase, Counter, Setting, AuditLog
  middleware/   auth (JWT + roles), upload (multer + sharp), rate limits, errors
  controllers/  public, auth, players, teams, users, auction, dashboard
  routes/       all routes with role guards
  utils/        validation, atomic helper, admin seeding
```

## API overview

| Method & path | Who |
|---|---|
| `GET /api/public/config` · `POST /api/public/register` | Public (rate-limited) |
| `GET /api/settings/registration` · `PATCH /api/settings/registration` `{ open: true/false }` | Admin |
| `POST /api/auth/login` · `GET /api/auth/me` | Public / logged in |
| `GET /api/dashboard` | Admin, Auctioneer |
| `GET /api/players` (`limit` up to 300) · `GET /api/players/ids` · `GET /api/players/:id` | Admin (all), Auctioneer (Paid only) |
| `PUT /api/players/:id` · `PATCH /api/players/:id/payment` · `PATCH /api/players/payment/bulk` | Admin |
| `GET /api/teams` · `GET /api/teams/stats` · `GET /api/teams/:id` | Admin, Auctioneer |
| `POST/PUT/DELETE /api/teams` | Admin |
| `GET/POST/PUT /api/users`, `PATCH /api/users/:id/password`, `PATCH /api/users/:id/status` | Admin |
| `POST /api/auction/sell` · `PUT /api/auction/sales/:playerId` · `POST /api/auction/sales/:playerId/undo` | **Auctioneer only** (Admin gets 403) |
| `GET /api/auction/purchases` | Admin, Auctioneer |
| `GET /api/audit-logs` (`who`=userId or `registrations`, `category`, `search`, `from`, `to`) | **Admin only** |

## Rules enforced on the server
- Registration can be closed by an Admin; while closed, `POST /api/public/register` returns 403 "Registration is disabled. Please contact the admin."
- Mobile numbers are unique; S.L. Nos come from an atomic counter (no duplicates under load).
- Players are saved Unpaid; only an Admin can mark Paid/Unpaid, and a sold player cannot be marked Unpaid.
- Only Paid, Not Sold players can be sold; amount must be > 0 and within the team's remaining purse.
- Edit sale returns the old amount to the old team, then takes the new amount from the new team; history is kept.
- Undo sale returns the money and keeps the purchase record marked as reversed.
- A team's purse cannot be set below what it has already spent; teams with purchased players cannot be deleted.
- Deactivating a user or resetting their password logs them out immediately.
- Every login (including failed ones), registration, payment change, player / team / user change, sale, sale edit, undo and registration open/close is written to the audit log.
