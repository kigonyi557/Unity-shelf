require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { startReminderCron } = require('./cron');

const app = express();
app.use(express.json());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Paths match the front end's CONFIG object exactly — only the domain
// prefix needs to change there, not these paths.
app.use('/webhook/library-auth', require('./routes/auth'));
app.use('/webhook/library-registration', require('./routes/register'));
app.use('/webhook/library-verify-account', require('./routes/verify'));
app.use('/webhook/library-change-pin', require('./routes/changePin'));
app.use('/webhook/library-forgot-password', require('./routes/forgotPassword'));
app.use('/webhook/library-reset-password', require('./routes/resetPassword'));
app.use('/webhook/library-sync', require('./routes/sync'));
app.use('/webhook/library-update', require('./routes/transaction'));
app.use('/webhook/library-reserve', require('./routes/reserve'));
app.use('/webhook/library-cancel-reservation', require('./routes/cancelReservation'));
app.use('/webhook/library-admin-overview', require('./routes/adminOverview'));
app.use('/webhook/library-extract-pdf', require('./routes/extractBooksFromPdf'));
app.use('/webhook/library-import-books', require('./routes/importBooks'));
app.use('/webhook/library-update-profile', require('./routes/updateProfile'));
app.use('/webhook/library-all-users', require('./routes/allUsers'));
app.use('/webhook/library-user-detail', require('./routes/userDetail'));
app.use('/webhook/library-book-interaction', require('./routes/bookInteraction'));
app.use('/webhook/library-book-interaction-get', require('./routes/bookInteractionGet'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Unity Shelf backend listening on port ${PORT}`);
  startReminderCron();
});
