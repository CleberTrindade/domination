'use strict';
const fs = require('node:fs');
const path = require('node:path');
async function migrate(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(482761902)');
    await db.query('CREATE TABLE IF NOT EXISTS world_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of fs.readdirSync(path.join(__dirname, 'migrations')).filter(n => n.endsWith('.sql')).sort()) {
      if (!(await db.query('SELECT name FROM world_migrations WHERE name=$1', [name])).rows.length) {
        await db.query(fs.readFileSync(path.join(__dirname, 'migrations', name), 'utf8'));
        await db.query('INSERT INTO world_migrations(name) VALUES($1)', [name]);
      }
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
module.exports = { migrate };
