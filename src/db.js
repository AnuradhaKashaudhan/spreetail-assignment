const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_DB_PATH = process.env.VERCEL
  ? path.join(os.tmpdir(), 'shared-expenses-app.db')
  : path.join(DATA_DIR, 'app.db');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

function openDatabase() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  seed(db);
  return db;
}

function seed(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0) return;

  const passwordHash = bcrypt.hashSync('password123', 10);
  const users = ['Aisha', 'Rohan', 'Priya', 'Meera', 'Dev', 'Sam'];
  const insertUser = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)');
  for (const name of users) {
    insertUser.run(name, `${name.toLowerCase()}@flat.test`, passwordHash);
  }

  const aisha = db.prepare('SELECT id FROM users WHERE name = ?').get('Aisha').id;
  const group = db.prepare('INSERT INTO groups (name, created_by_user_id) VALUES (?, ?)').run('Flatmates', aisha);
  const userByName = db.prepare('SELECT id FROM users WHERE name = ?');
  const insertMembership = db.prepare(`
    INSERT INTO group_memberships (group_id, user_id, joined_on, left_on)
    VALUES (?, ?, ?, ?)
  `);

  for (const name of ['Aisha', 'Rohan', 'Priya']) {
    insertMembership.run(group.lastInsertRowid, userByName.get(name).id, '2026-02-01', null);
  }
  insertMembership.run(group.lastInsertRowid, userByName.get('Meera').id, '2026-02-01', '2026-03-31');
  insertMembership.run(group.lastInsertRowid, userByName.get('Sam').id, '2026-04-15', null);
  insertMembership.run(group.lastInsertRowid, userByName.get('Dev').id, '2026-04-01', '2026-04-14');
}

module.exports = { openDatabase, DB_PATH };
