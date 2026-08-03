require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://lms-frontend-4nk.pages.dev';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === 'http://localhost:5173' || origin === 'http://localhost:3000') return true;
  if (origin === FRONTEND_URL) return true;
  if (/^https:\/\/[a-f0-9]+\.lms-frontend-4nk\.pages\.dev$/.test(origin)) return true;
  // Production apex + any Cloudflare Pages alias of this project
  if (origin === 'https://lms-frontend-4nk.pages.dev') return true;
  return false;
}

app.use(helmet());
app.use(cors({
  origin: isAllowedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '100kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests to this endpoint.' },
});

// Root route for Render health check / verification
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: "LMS Backend is running successfully!", 
    status: "OK" 
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API Routes
app.use('/api/youtube', require('./routes/youtube'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/admin/setup', strictLimiter, require('./routes/admin-setup'));
app.use('/api/crypto', require('./routes/crypto-payments'));
app.use('/api/r2', strictLimiter, require('./routes/r2-videos'));
app.use('/api/telegram-groups', require('./routes/telegram-groups'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/mail', strictLimiter, require('./routes/mail'));
app.use('/api/admin', require('./routes/admin'));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
