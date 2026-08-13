const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const VALID_BRANCHES = ['Unity West', 'Unity East', 'Unity Gardens'];

// Finds the highest numeric suffix already in use for a given set of IDs
// (e.g. "T0812" -> 812), so new IDs continue the existing sequence instead
// of colliding with it.
function highestNumericSuffix(rows, idField) {
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)$/.exec(r[idField] || '');
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// POST /webhook/library-import-books  (requireAuth, Library Assistant only)
// Body: { branch: 'Unity West', books: [{ title, author, referenceNo, ageBracket, grade, copies }] }
// This is the "confirm" step — only ever called after a human has reviewed
// the extracted list from /webhook/library-extract-pdf (or entered books
// manually). Nothing here is auto-approved from the PDF alone.
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { branch, books } = req.body || {};

  if (!VALID_BRANCHES.includes(branch)) {
    return res.status(400).json({ success: false, message: 'Please choose a valid branch.' });
  }
  if (!Array.isArray(books) || books.length === 0) {
    return res.status(400).json({ success: false, message: 'No books to import.' });
  }

  const titleRows = db.prepare('SELECT title_id FROM library_titles').all();
  const copyRows = db.prepare('SELECT copy_id FROM library_copies').all();
  let titleCounter = highestNumericSuffix(titleRows, 'title_id');
  let copyCounter = highestNumericSuffix(copyRows, 'copy_id');

  const insertTitle = db.prepare(`
    INSERT INTO library_titles (title_id, title, author, reference_no, age_bracket, grade)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertCopy = db.prepare(`
    INSERT INTO library_copies (copy_id, title_id, branch, status)
    VALUES (?, ?, ?, 'AVAILABLE')
  `);

  const insertAll = db.transaction((items) => {
    let titlesAdded = 0;
    let copiesAdded = 0;

    for (const book of items) {
      const title = (book.title || '').trim();
      if (!title) continue;

      titleCounter += 1;
      const titleId = `T${String(titleCounter).padStart(4, '0')}`;

      insertTitle.run(
        titleId,
        title,
        book.author || null,
        book.referenceNo || null,
        book.ageBracket === 'Kids' ? 'Kids' : 'Adults',
        book.grade || null
      );
      titlesAdded += 1;

      const copyCount = Math.max(1, parseInt(book.copies, 10) || 1);
      for (let i = 0; i < copyCount; i++) {
        copyCounter += 1;
        const copyId = `C${String(copyCounter).padStart(5, '0')}`;
        insertCopy.run(copyId, titleId, branch, 'AVAILABLE');
        copiesAdded += 1;
      }
    }

    return { titlesAdded, copiesAdded };
  });

  try {
    const result = insertAll(books);
    res.json({
      success: true,
      ...result,
      message: `Added ${result.titlesAdded} new title(s), ${result.copiesAdded} new copy/copies to ${branch}.`,
    });
  } catch (err) {
    console.error('[import-books] error:', err);
    res.status(500).json({ success: false, message: 'Failed to save books to the catalog.' });
  }
});

module.exports = router;
