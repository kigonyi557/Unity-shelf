const express = require('express');
const db = require('../db');
const { sha256Hex, safeEqual } = require('../util');

const router = express.Router();
const MAX_ATTEMPTS = 5;

// POST /webhook/library-reset-password   Body: { userId, code, newPasscodeHash }
// newPasscodeHash is computed client-side the same way as everywhere else
// in this app — sha256(userId + '::' + newPin) — so the server never
// handles a raw password, only the pre-salted hash.
router.post('/', (req, res) => {
  const { userId, code, newPasscodeHash } = req.body || {};
  if (!userId || !newPasscodeHash) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  if (!account) return res.status(404).json({ success: false, message: 'Account not found.' });

  const record = db.prepare('SELECT * FROM library_verification_codes WHERE user_id = ?').get(userId);
  if (!record) return res.status(400).json({ success: false, message: 'No pending reset request — please request a new code.' });
  if (new Date(record.expires_at) < new Date()) {
    db.prepare('DELETE FROM library_verification_codes WHERE user_id = ?').run(userId);
    return res.status(400).json({ success: false, message: 'Code expired — please request a new one.' });
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    db.prepare('DELETE FROM library_verification_codes WHERE user_id = ?').run(userId);
    return res.status(429).json({ success: false, message: 'Too many attempts — please request a new code.' });
  }
  if (!safeEqual(sha256Hex(String(code || '')), record.code_hash)) {
    db.prepare('UPDATE library_verification_codes SET attempts = attempts + 1 WHERE user_id = ?').run(userId);
    return res.status(400).json({ success: false, message: 'Incorrect code.' });
  }

  // Also marks the account verified — harmless if it already was, and
  // covers the edge case of someone resetting a password before ever
  // completing their original verification.
  db.prepare('UPDATE library_accounts SET passcode_hash = ?, verified = 1 WHERE user_id = ?').run(newPasscodeHash, userId);
  db.prepare('DELETE FROM library_verification_codes WHERE user_id = ?').run(userId);
  res.json({ success: true, message: 'Password updated — you can log in now.' });
});

module.exports = router;
