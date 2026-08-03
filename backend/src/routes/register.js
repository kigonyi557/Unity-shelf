const express = require('express');
const db = require('../db');
const { genVerificationCode, sha256Hex } = require('../util');

const router = express.Router();
const VALID_TYPES = ['Resident', 'Staff', 'Library Assistant'];
const STAFF_DOMAIN = '@unityhomes.co.ke';
const EMAIL_FORMAT = /^\S+@\S+\.\S+$/;

// POST /webhook/library-registration
// No verification codes anymore. Every account is created with a
// server-generated default PIN and must_change_password = 1. Staff hand
// the default PIN to the resident directly; the first successful login
// forces them into a "create your own password" screen.
router.post('/', async (req, res) => {
  const b = req.body || {};
  const { name, estateBranch, accountType, workEmail, email, unitNumber, phone, isAdult } = b;

  if (!name || !accountType || !VALID_TYPES.includes(accountType)) {
    return res.status(400).json({ success: false, message: 'Missing or invalid registration fields.' });
  }

  const isStaffLike = accountType === 'Staff' || accountType === 'Library Assistant';
  let userId;
  let contactEmail = null;

  if (isStaffLike) {
    const workEmailNorm = (workEmail || '').trim().toLowerCase();
    if (!workEmailNorm.endsWith(STAFF_DOMAIN)) {
      return res.status(400).json({ success: false, message: `${accountType} accounts require a work email ending in ${STAFF_DOMAIN}.` });
    }
    userId = workEmailNorm;
    contactEmail = workEmailNorm;
  } else {
    if (!phone) return res.status(400).json({ success: false, message: 'Phone number is required for resident accounts.' });
    userId = phone.trim();
    const emailNorm = (email || '').trim().toLowerCase();
    if (emailNorm) {
      if (!EMAIL_FORMAT.test(emailNorm)) {
        return res.status(400).json({ success: false, message: 'That email address does not look valid.' });
      }
      contactEmail = emailNorm;
    }
  }

  const existing = db.prepare('SELECT user_id FROM library_accounts WHERE user_id = ?').get(userId);
  if (existing) {
    return res.status(409).json({ success: false, message: 'An account already exists for that email or phone number.' });
  }

  const defaultPin = genVerificationCode();
  const passcodeHash = sha256Hex(`${userId}::${defaultPin}`);

  db.prepare(`
    INSERT INTO library_accounts (user_id, name, account_type, estate_branch, work_email, unit_number, phone, is_adult, passcode_hash, verified, must_change_password, registered_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
  `).run(userId, name, accountType, estateBranch || null, contactEmail, unitNumber || null, isStaffLike ? null : userId, isAdult ? 1 : 0, passcodeHash, new Date().toISOString());

  res.json({
    success: true,
    userId,
    defaultPin,
    message: `Account created. Default PIN: ${defaultPin}. Please hand this to the user directly — they'll be asked to set their own password on first login.`,
  });
});

module.exports = router;
