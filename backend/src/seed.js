// Run with: npm run seed
require('dotenv').config();
const crypto = require('crypto');
const db = require('./db');

function saltedHash(userId, pin) {
  return crypto.createHash('sha256').update(`${userId}::${pin}`).digest('hex');
}

const titles = [
  { title_id: 't_1', title: 'The Lean Startup', author: 'Eric Ries', reference_no: '9780307887894', age_bracket: 'Adults' },
  { title_id: 't_2', title: 'Zero to One', author: 'Peter Thiel', reference_no: '9780804139298', age_bracket: 'Adults' },
  { title_id: 't_3', title: 'Atomic Habits', author: 'James Clear', reference_no: '9781847941831', age_bracket: 'Adults' },
  { title_id: 't_4', title: 'Things Fall Apart', author: 'Chinua Achebe', reference_no: '9780385474542', age_bracket: 'Adults' },
  { title_id: 't_5', title: 'The Gruffalo', author: 'Julia Donaldson', reference_no: '9780333710937', age_bracket: 'Kids', grade: 'Pre-K–2' },
  { title_id: 't_6', title: 'Charlotte\'s Web', author: 'E. B. White', reference_no: '9780061124952', age_bracket: 'Kids', grade: '2–5' },
];

const copies = [
  { copy_id: 'c_1a', title_id: 't_1', branch: 'Unity West', status: 'AVAILABLE' },
  { copy_id: 'c_1b', title_id: 't_1', branch: 'Unity East', status: 'ON_LOAN' },
  { copy_id: 'c_2a', title_id: 't_2', branch: 'Unity Gardens', status: 'AVAILABLE' },
  { copy_id: 'c_3a', title_id: 't_3', branch: 'Unity West', status: 'ON_LOAN' },
  { copy_id: 'c_3b', title_id: 't_3', branch: 'Unity Gardens', status: 'ON_LOAN' },
  { copy_id: 'c_4a', title_id: 't_4', branch: 'Unity East', status: 'AVAILABLE' },
  { copy_id: 'c_5a', title_id: 't_5', branch: 'Unity West', status: 'AVAILABLE' },
  { copy_id: 'c_5b', title_id: 't_5', branch: 'Unity Gardens', status: 'AVAILABLE' },
  { copy_id: 'c_6a', title_id: 't_6', branch: 'Unity East', status: 'ON_LOAN' },
];

const insertTitle = db.prepare(`
  INSERT OR IGNORE INTO library_titles (title_id, title, author, reference_no, age_bracket, grade)
  VALUES (@title_id, @title, @author, @reference_no, @age_bracket, @grade)
`);
const insertCopy = db.prepare(`
  INSERT OR IGNORE INTO library_copies (copy_id, title_id, branch, status) VALUES (@copy_id, @title_id, @branch, @status)
`);

db.transaction(() => {
  for (const t of titles) insertTitle.run({ grade: null, ...t });
  for (const c of copies) insertCopy.run(c);
})();

// Test accounts — PIN is "1234" for all three, already verified so you can
// log in immediately without needing email delivery configured yet.
const testAccounts = [
  { user_id: 'assistant@unityhomes.co.ke', name: 'Amos (Library Assistant)', account_type: 'Library Assistant', estate_branch: 'Unity West', work_email: 'assistant@unityhomes.co.ke' },
  { user_id: 'staff@unityhomes.co.ke', name: 'Test Staff Member', account_type: 'Staff', estate_branch: 'Unity East', work_email: 'staff@unityhomes.co.ke' },
  { user_id: '0700000001', name: 'Test Resident', account_type: 'Resident', estate_branch: 'Unity Gardens', phone: '0700000001', unit_number: 'GARDENS-4A' },
];

const insertAccount = db.prepare(`
  INSERT OR IGNORE INTO library_accounts (user_id, name, account_type, estate_branch, work_email, unit_number, phone, passcode_hash, verified, registered_date)
  VALUES (@user_id, @name, @account_type, @estate_branch, @work_email, @unit_number, @phone, @passcode_hash, 1, @registered_date)
`);

db.transaction(() => {
  for (const a of testAccounts) {
    insertAccount.run({
      work_email: null, unit_number: null, phone: null, ...a,
      passcode_hash: saltedHash(a.user_id, '1234'),
      registered_date: new Date().toISOString(),
    });
  }
})();

console.log(`Seeded ${titles.length} titles / ${copies.length} copies.`);
console.log('Test accounts (all PIN 1234, already verified):');
testAccounts.forEach(a => console.log(`  ${a.account_type.padEnd(18)} → ${a.user_id}`));
