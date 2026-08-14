const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const VALID_ESTATES = ['Unity One', 'Unity West', 'Unity East', 'Unity Gardens', 'Silver Hill', 'Unity Parkside'];

// POST /webhook/library-update-profile  (requireAuth)
// Body: { userId, name, estateBranch, unitNumber, email }
// Login ID (phone or work email) and account type are intentionally NOT
// editable here — the login ID is the database primary key this whole
// system is built around, and account type controls what a person is
// allowed to do. Changing either is a much bigger operation than a
// profile edit and isn't handled by this route.
router.post('/', requireAuth, (req, res) => {
  const { userId, name, estateBranch, unitNumber, email } = req.body || {};

  if (req.account.userId !== userId) {
    return res.status(403).json({ success: false, message: 'You can only edit your own profile.' });
  }

  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    return res.status(400).json({ success: false, message: 'Name cannot be empty.' });
  }

  const account = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  if (!account) {
    return res.status(404).json({ success: false, message: 'Account not found.' });
  }

  const isResident = account.account_type === 'Resident';

  if (isResident && estateBranch && !VALID_ESTATES.includes(estateBranch)) {
    return res.status(400).json({ success: false, message: 'Please choose a valid estate.' });
  }

  // For residents, work_email doubles as their optional recovery email.
  // For staff/library assistants, work_email IS their login ID — never
  // overwrite it from this route.
  db.prepare(`
    UPDATE library_accounts
    SET name = ?, estate_branch = ?, unit_number = ?, work_email = ?
    WHERE user_id = ?
  `).run(
    trimmedName,
    isResident ? (estateBranch || account.estate_branch) : account.estate_branch,
    isResident ? (unitNumber || null) : account.unit_number,
    isResident ? (email || null) : account.work_email,
    userId
  );

  const updated = db.prepare('SELECT * FROM library_accounts WHERE user_id = ?').get(userId);
  res.json({
    success: true,
    user: {
      userId: updated.user_id,
      name: updated.name,
      estateBranch: updated.estate_branch,
      accountType: updated.account_type,
      unitNumber: updated.unit_number,
      email: updated.work_email,
      phone: updated.phone,
    },
    message: 'Profile updated successfully.',
  });
});

module.exports = router;
