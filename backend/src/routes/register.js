const express = require('express');
const db = require('../db');
const { genVerificationCode, sha256Hex } = require('../util');
const { sendMail } = require('../email');

const router = express.Router();
const VALID_TYPES = ['Resident', 'Staff', 'Library Assistant'];
const STAFF_DOMAIN = '@unityhomes.co.ke';
const CODE_TTL_MINUTES = 15;

// POST /webhook/library-registration
router.post('/', async (req, res) => {
  const b = req.body || {};
  const { name, estateBranch, accountType, passcodeHash, workEmail, unitNumber, phone, dateOfBirth } = b;

  if (!name || !accountType || !passcodeHash || !VALID_TYPES.includes(accountType)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid registration fields.' });
  }

  const dob = new Date(dateOfBirth);
  if (!dateOfBirth || isNaN(dob.getTime()) || dob > new Date()) {
    return res.status(400).json({ success: false, message: 'A valid date of birth is required.' });
  }

  const isStaffLike = accountType === 'Staff' || accountType === 'Library Assistant';
  let userId;

  if (isStaffLike) {
    const email = (workEmail || '').trim().toLowerCase();
    if (!email.endsWith(STAFF_DOMAIN)) {
      return res.status(400).json({ success: false, message: `${accountType} accounts require a work email ending in ${STAFF_DOMAIN}.` });
    }
    userId = email;
  } else {
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required for resident accounts.' });
    userId = phone.trim();
  }

  const existing = db.prepare('SELECT user_id FROM library_accounts WHERE user_id = ?').get(userId);
  if (existing) {
    return res.status(409).json({ success: false, message: 'An account already exists for that email or phone number.' });
  }

  // Residents register with phone only — there's no SMS provider wired up
  // yet, so there's no channel to deliver a code to them. Rather than
  // block registration entirely, residents are auto-verified; Staff and
  // Library Assistant accounts (which have a real work email) go through
  // genuine email verification. See README for adding SMS later.
  const willAutoVerify = !isStaffLike;

  db.prepare(`
    INSERT INTO library_accounts (user_id, name, account_type, estate_branch, work_email, unit_number, phone, date_of_birth, passcode_hash, verified, registered_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, name, accountType, estateBranch || null, isStaffLike ? userId : null, unitNumber || null, isStaffLike ? null : userId, dateOfBirth, passcodeHash, willAutoVerify ? 1 : 0, new Date().toISOString());

  if (!willAutoVerify) {
    const code = genVerificationCode();
    const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString();
    db.prepare(`
      INSERT INTO library_verification_codes (user_id, code_hash, expires_at, attempts, created_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at
    `).run(userId, sha256Hex(code), expires_at, new Date().toISOString());

    await sendMail({
      to: userId,
      subject: 'Verify your Unity Shelf account',
      text: `Hi ${name},\n\nYour verification code is: ${code}\n\nIt expires in ${CODE_TTL_MINUTES} minutes.\n\nThe Unity Shelf`,
    });
  }

  res.json({
    success: true,
    userId,
    message: willAutoVerify
      ? 'Account created — you can verify immediately with any code to continue.'
      : `Account created — check ${userId} for your verification code.`,
  });
});

module.exports = router;
