const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', 1); // correct client IPs for rate limiting behind a proxy
app.disable('x-powered-by');

const allowedOrigins = env.clientUrl.split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);
app.use(express.json({ limit: '1mb' }));

app.use('/uploads', express.static(env.uploadsDir, { maxAge: '7d', fallthrough: false }));
app.use('/api', routes);

app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'API route not found' }));
app.use(errorHandler);

module.exports = app;
