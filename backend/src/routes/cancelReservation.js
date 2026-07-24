const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /webhook/library-cancel-reservation   (requires Authorization: Bearer <token>)
// Body: { userId, reservationId }
router.post('/', requireAuth, (req, res) => {
  const { userId, reservationId } = req.body || {};

  const reservation = db.prepare('SELECT * FROM library_reservations WHERE reservation_id = ?').get(reservationId);
  if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found.' });
  if (reservation.user_id !== userId || req.account.userId !== userId) {
    return res.status(403).json({ success: false, message: 'You can only cancel your own reservations.' });
  }

  if (reservation.status === 'READY' && reservation.copy_id) {
    db.prepare('UPDATE library_copies SET status = ? WHERE copy_id = ?').run('AVAILABLE', reservation.copy_id);
  }
  db.prepare('DELETE FROM library_reservations WHERE reservation_id = ?').run(reservationId);

  res.json({ success: true });
});

module.exports = router;
