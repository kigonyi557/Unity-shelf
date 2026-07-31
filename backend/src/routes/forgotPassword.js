const express = require('express');
const db = require('../db');
const { genVerificationCode, sha256Hex } = require('../util');
const { sendMail } = require('../email');

const router = express.Router();
const CODE_TTL_MINUTES = 15;

// POST /webhook/library-forgot-password   Body: { userId }
// Reuses the same library_verification_codes table as account
// verification — a reset code simply overwrites any pending code for
// that user, which is fine since only one code should ever be "live" at
// a time per account.
router.post('/', async (req, res) => {
  const userId = (req.body?.userId || '').trim();
  if (!userId) return res.status(400).json({ success: false, message: 'Enter your email or phone number first.' });

  const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  if (!account) {
    return res.status(404).json({ success: false, message: 'No account found for that email or phone number.' });
  }

  // work_email doubles as the general contact/verification email for
  // every account type (Staff/Library Assistant use it directly;
  // Residents' separate email at registration is stored here too).
  const destination = account.work_email;
  if (!destination) {
    return res.status(400).json({ success: false, message: 'This account has no email on file to send a reset code to — contact a Library Assistant for help.' });
  }

  const code = genVerificationCode();
  const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString();
  db.prepare(`
    INSERT INTO library_verification_codes (user_id, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at
  `).run(userId, sha256Hex(code), expires_at, new Date().toISOString());

  await sendMail({
    to: destination,
    subject: 'Reset your Unity Shelf password',
    text: `Hi ${account.name},\n\nSomeone requested a password reset for your Unity Shelf account. Your reset code is: ${code}\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If this wasn't you, you can safely ignore this email — your password won't change unless this code is used.\n\nThe Unity Shelf`,
  });

  res.json({ success: true, userId, verifyDestination: destination, message: `Reset code sent — check ${destination}.` });
});

module.exports = router;
