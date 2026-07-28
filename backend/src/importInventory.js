// Imports the real Unity Homes library inventory (from the company-provided
// spreadsheet) into the database. Safe to run more than once — uses
// INSERT OR IGNORE, so re-running never creates duplicates or overwrites
// anything a librarian has since changed (e.g. a copy's status).
//
// Usage:  node src/importInventory.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const dataPath = path.join(__dirname, 'data', 'inventory.json');
const { titles, copies } = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const insertTitle = db.prepare(`
  INSERT OR IGNORE INTO library_titles (title_id, title, author, reference_no, age_bracket, grade)
  VALUES (@title_id, @title, @author, @reference_no, @age_bracket, @grade)
`);
const insertCopy = db.prepare(`
  INSERT OR IGNORE INTO library_copies (copy_id, title_id, branch, status)
  VALUES (@copy_id, @title_id, @branch, @status)
`);

let titlesAdded = 0, copiesAdded = 0;

db.transaction(() => {
  for (const t of titles) {
    const info = insertTitle.run(t);
    if (info.changes) titlesAdded++;
  }
  for (const c of copies) {
    const info = insertCopy.run(c);
    if (info.changes) copiesAdded++;
  }
})();

console.log(`Inventory import complete.`);
console.log(`  Titles:  ${titlesAdded} added, ${titles.length - titlesAdded} already existed (skipped).`);
console.log(`  Copies:  ${copiesAdded} added, ${copies.length - copiesAdded} already existed (skipped).`);
