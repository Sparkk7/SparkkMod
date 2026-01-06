const Database = require('better-sqlite3');
const db = new Database('sparkkmod.db');

db.prepare(`
CREATE TABLE IF NOT EXISTS infractions (
  userId TEXT PRIMARY KEY,
  count INTEGER
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
)
`).run();

module.exports = db;