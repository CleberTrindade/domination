'use strict';
const { PGlite } = require('@electric-sql/pglite');
// Real Postgres semantics, one connection. Queue transactions because PGlite is single-user.
async function postgres() {
  const db = new PGlite(); await db.waitReady;
  let queue = Promise.resolve();
  async function lock() {
    const previous = queue; let release;
    queue = new Promise(resolve => { release = resolve; });
    await previous; return release;
  }
  async function query(sql, params) {
    if (params?.length) return db.query(sql, params);
    const results = await db.exec(sql); return results[results.length - 1] || { rows: [] };
  }
  const pool = {
    async query(sql, params) { const release = await lock(); try { return await query(sql, params); } finally { release(); } },
    async connect() { const release = await lock(); return { query, release }; },
    async end() {}
  };
  return { pool, destroy: () => db.close() };
}
module.exports = { postgres };
