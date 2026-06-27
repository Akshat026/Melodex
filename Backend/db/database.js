// database.js — SQLite Connection & Setup
// Opens the database file and runs migrations on first start.
// Every other file imports `db` from here — single connection, no duplication.

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

const DB_PATH        = path.join(__dirname, "melodex.db");
const MIGRATION_PATH = path.join(__dirname, "migrations", "init.sql");

// Open (or create) the SQLite database file
const db = new Database(DB_PATH);

// Performance settings — run once at startup
db.pragma("journal_mode = WAL");  // faster writes, safe for concurrent reads
db.pragma("foreign_keys = ON");   // enforce referential integrity

// Run migrations — creates tables if they don't exist yet
function runMigrations() {
  try {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
    db.exec(sql);
    console.log("Database: migrations applied ✅");
  } catch (err) {
    console.error("Database: migration failed →", err.message);
    process.exit(1); // can't run without a valid database
  }
}

runMigrations();

module.exports = db;