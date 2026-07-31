const express = require('express');
const db = require('../db');
const { genVerificationCode, sha256Hex } = require('../util');
const { sendMail } = require('../email');

const router = express.Router();
const VALID_TYPES = ['Resident', 'Staff', 'Library Assistant'];
const STAFF_DOMAIN = '@unityhomes.co.ke';
const CODE_TTL_MINUTES = 15;
const EMAIL_FORMAT = /^\S+@\S+\.\S+$/;

// POST /webhook/library-registration
router.post('/', async (req, res) => {
  const b = req.body || {};
  const { name, estateBranch, accountType, passcodeHash, workEmail, email, unitNumber, phone, isAdult } = b;

  if (!name || !accountType || !passcodeHash || !VALID_TYPES.includes(accountType)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid registration fields.' });
  }

  const isStaffLike = accountType === 'Staff' || accountType === 'Library Assistant';
  let userId;
  let verificationEmail;

  if (isStaffLike) {
    const workEmailNorm = (workEmail || '').trim().toLowerCase();
    if (!workEmailNorm.endsWith(STAFF_DOMAIN)) {
      return res.status(400).json({ success: false, message: `${accountType} accounts require a work email ending in ${STAFF_DOMAIN}.` });
    }
    userId = workEmailNorm;
    verificationEmail = workEmailNorm;
  } else {
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required for resident accounts.' });
    const emailNorm = (email || '').trim().toLowerCase();
    if (!EMAIL_FORMAT.test(emailNorm)) {
      return res.status(400).json({ success: false, message: 'A valid email address is required to receive your verification code.' });
    }
    userId = phone.trim();
    verificationEmail = emailNorm;
  }

  const existing = db.prepare('SELECT user_id FROM library_accounts WHERE user_id = ?').get(userId);
  if (existing) {
    return res.status(409).json({ success: false, message: 'An account already exists for that email or phone number.' });
  }

  // Everyone now registers with a real email (residents provide one
  // separately from their phone/login-id; staff use their work email for
  // both). That means every account can go through genuine email
  // verification — no more auto-verify bypass for residents.
  db.prepare(`
    INSERT INTO library_accounts (user_id, name, account_type, estate_branch, work_email, unit_number, phone, is_adult, passcode_hash, verified, registered_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(userId, name, accountType, estateBranch || null, verificationEmail, unitNumber || null, isStaffLike ? null : userId, isAdult ? 1 : 0, passcodeHash, new Date().toISOString());

  const code = genVerificationCode();
  const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString();
  db.prepare(`
    INSERT INTO library_verification_codes (user_id, code_hash, expires_at, attempts, created_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at
  `).run(userId, sha256Hex(code), expires_at, new Date().toISOString());

  await sendMail({
    to: verificationEmail,
    subject: 'Verify your Unity Shelf account',
    text: `Hi ${name},\n\nYour verification code is: ${code}\n\nIt expires in ${CODE_TTL_MINUTES} minutes.\n\nThe Unity Shelf`,
  });

  res.json({
    success: true,
    userId,
    verifyDestination: verificationEmail,
    message: `Account created — check ${verificationEmail} for your verification code.`,
  });
});

module.exports = router;
