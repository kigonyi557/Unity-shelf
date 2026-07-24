const express = require('express');
const db = require('../db');
const { sha256Hex, safeEqual } = require('../util');

const router = express.Router();
const MAX_ATTEMPTS = 5;

// POST /webhook/library-verify-account
router.post('/', (req, res) => {
  const { userId, code } = req.body || {};
  if (!userId) return res.status(400).json({ success: false, message: 'Missing account reference.' });

  const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  if (!account) return res.status(404).json({ success: false, message: 'Account not found.' });

  // Already verified (e.g. resident auto-verify at registration) — treat
  // any submitted code as a harmless no-op success so the UI flow completes.
  if (account.verified) return res.json({ success: true });

  const record = db.prepare('SELECT * FROM library_verification_codes WHERE user_id = ?').get(userId);
  if (!record) return res.status(400).json({ success: false, message: 'No pending verification for this account — please register again.' });
  if (new Date(record.expires_at) < new Date()) {
    db.prepare('DELETE FROM library_verification_codes WHERE user_id = ?').run(userId);
    return res.status(400).json({ success: false, message: 'Code expired — please register again for a new one.' });
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    db.prepare('DELETE FROM library_verification_codes WHERE user_id = ?').run(userId);
    return res.status(429).json({ success: false, message: 'Too many attempts — please register again for a new code.' });
  }

  if (!safeEqual(sha256Hex(String(code || '')), record.code_hash)) {
    db.prepare('UPDATE library_verification_codes SET attempts = attempts + 1 WHERE user_id = ?').run(userId);
    return res.status(400).json({ success: false, message: 'Incorrect code.' });
  }

  db.prepare('UPDATE library_accounts SET verified = 1 WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM library_verification_codes WHERE user_id = ?').run(userId);
  res.json({ success: true });
});

module.exports = router;
