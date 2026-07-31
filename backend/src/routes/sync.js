const express = require('express');
const db = require('../db');
const { evaluateLoanMetrics } = require('../util');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

const isAdultBracket = (bracket) => (bracket || '').toString().trim().toLowerCase() === 'adults';

// POST /webhook/library-sync   Body: { userId }  (userId '' for the public hero preview)
router.post('/', optionalAuth, (req, res) => {
  const userId = (req.body?.userId || '').trim();

  // Age-gate: accounts that self-declared under-18 at registration (the
  // "I am 18 or older" checkbox left unchecked) don't see Adults-bracket
  // titles at all — filtered out here, server-side, so it can't be
  // bypassed by editing the front end. Accounts with no is_adult value on
  // record (e.g. registered before this field existed) are treated as
  // adult rather than locked out of content they could already see.
  let isMinor = false;
  if (userId) {
    const account = db.prepare('SELECT is_adult FROM library_accounts WHERE user_id = ?').get(userId);
    isMinor = !!account && account.is_adult === 0;
  }

  const titleRows = db.prepare('SELECT * FROM library_titles').all()
    .filter(t => !isMinor || !isAdultBracket(t.age_bracket));
  const copyRows = db.prepare('SELECT * FROM library_copies').all();
  const copiesByTitle = {};
  for (const c of copyRows) {
    (copiesByTitle[c.title_id] = copiesByTitle[c.title_id] || []).push({
      copyId: c.copy_id, branch: c.branch, status: c.status,
    });
  }
  const titles = titleRows.map(t => ({
    id: t.title_id, title: t.title, author: t.author, referenceNo: t.reference_no,
    ageBracket: t.age_bracket, grade: t.grade, copies: copiesByTitle[t.title_id] || [],
  }));

  let loans = [];
  let reservations = [];
  if (userId) {
    loans = db.prepare(`SELECT * FROM library_loans WHERE user_id = ? AND status = 'ACTIVE'`).all(userId)
      .map(l => ({ id: l.loan_id, copy_id: l.copy_id, title_id: l.title_id, book_title: l.book_title, branch: l.branch, user_id: l.user_id, borrowed_at: l.borrowed_at }));
    reservations = db.prepare(`SELECT * FROM library_reservations WHERE user_id = ?`).all(userId)
      .map(r => ({ id: r.reservation_id, title_id: r.title_id, book_title: r.book_title, branch: r.branch, status: r.status, expires_at: r.expires_at }));
  }

  const totalCopies = copyRows.length;
  const activeLoansCount = db.prepare(`SELECT COUNT(*) AS n FROM library_loans WHERE status = 'ACTIVE'`).get().n;
  const estatesCount = new Set(copyRows.map(c => c.branch)).size;

  const topBooksRaw = db.prepare(`
    SELECT title_id, COUNT(*) AS timesBorrowed FROM library_loans GROUP BY title_id ORDER BY timesBorrowed DESC LIMIT 5
  `).all();
  const topBooks = topBooksRaw.map(row => {
    const t = titleRows.find(x => x.title_id === row.title_id);
    return t ? { title: t.title, author: t.author, timesBorrowed: row.timesBorrowed } : null;
  }).filter(Boolean);

  res.json({
    titles, loans, reservations, restrictedForMinor: isMinor,
    stats: { totalTitles: titles.length, totalCopies, activeLoans: activeLoansCount, estatesCount, topBooks },
  });
});

module.exports = router;
