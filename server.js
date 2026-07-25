require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
app.use('/api/admin/setup', require('./routes/admin-setup'));
app.use('/api/crypto', require('./routes/crypto-payments'));
app.use('/api/r2', require('./routes/r2-videos'));
app.use('/api/telegram-groups', require('./routes/telegram-groups'));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
