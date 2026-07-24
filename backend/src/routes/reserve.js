const express = require('express');
const db = require('../db');
const { genId } = require('../util');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-reserve   (requires Authorization: Bearer <token>)
// Body: { userId, titleId, branch }
router.post('/', requireAuth, (req, res) => {
  const { userId, titleId, branch } = req.body || {};
  if (req.account.userId !== userId) {
    return res.status(403).json({ success: false, message: 'You can only reserve for your own account.' });
  }

  const title = db.prepare('SELECT * FROM library_titles WHERE title_id = ?').get(titleId);
  if (!title) return res.status(404).json({ success: false, message: 'Title not found.' });

  const hasBranchCopy = db.prepare('SELECT 1 FROM library_copies WHERE title_id = ? AND branch = ?').get(titleId, branch);
  if (!hasBranchCopy) return res.status(404).json({ success: false, message: 'No copies of this title exist at that branch.' });

  const existing = db.prepare(`
    SELECT 1 FROM library_reservations WHERE user_id = ? AND title_id = ? AND branch = ?
  `).get(userId, titleId, branch);
  if (existing) return res.status(409).json({ success: false, message: 'You already have a reservation for this title at that branch.' });

  const account = db.prepare('SELECT name FROM library_accounts WHERE user_id = ?').get(userId);
  const reservation_id = genId('r');
  db.prepare(`
    INSERT INTO library_reservations (reservation_id, title_id, book_title, branch, user_id, requester_name, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'WAITING', ?)
  `).run(reservation_id, titleId, title.title, branch, userId, account?.name || '', new Date().toISOString());

  res.json({ success: true, message: `You're on the waitlist for "${title.title}" at ${branch}.` });
});

module.exports = router;
