
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { WebSocketServer } = require('ws');
const { migrate } = require('./database');
const { createWorldService } = require('./world-service');
const { browserEngine,browserMaps } = require('./browser-assets');

function databasePool() {
  if (!process.env.DATABASE_URL) return null;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6,
    connectionTimeoutMillis: 4000, idleTimeoutMillis: 10000, query_timeout: 8000 });
  pool.on('error', () => console.error('Conexão ociosa com o banco indisponível.'));
  return pool;
}
async function createApplication({ pool = databasePool(), worldOptions = {} } = {}) {
  if (pool) await migrate(pool);
  const world = createWorldService(pool, worldOptions);
  await world.initialize();
  const APP_ENV = process.env.APP_ENV || 'mundo-aberto';
  const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
  const SIM_DELAY = +process.env.SIM_DELAY_MS || 0;
  const rooms = new Map();
  let seq = 0, dbProbe, dbProbeAt = 0;
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/world.js', ['world.js', 'application/javascript; charset=utf-8']],
    ['/world-motion.js', ['world-motion.js', 'application/javascript; charset=utf-8']],
    ['/troop-art.js', ['troop-art.js', 'application/javascript; charset=utf-8']],
    ['/art/troops-initial-v1.png', ['art/troops-initial-v1.png', 'image/png']],
    ['/art/central-v1.png', ['art/central-v1.png', 'image/png']],
    ['/battle-worker.js', ['battle-worker.js', 'application/javascript; charset=utf-8']],
    ['/sergipe-map.js', ['sergipe-map.js', 'application/javascript; charset=utf-8']],
    ['/world.css', ['world.css', 'text/css; charset=utf-8']]
  ].map(([url, [filename, mime]]) => [url, { body: fs.readFileSync(path.join(__dirname, '../public', filename)), mime }]));
  assets.set('/battle-engine.js',{body:browserEngine(),mime:'application/javascript; charset=utf-8'});
  assets.set('/battle-maps.js',{body:browserMaps(),mime:'application/javascript; charset=utf-8'});
  assets.set('/browser-battle.js',{body:fs.readFileSync(path.join(__dirname,'../shared/browser-battle.js')),mime:'application/javascript; charset=utf-8'});
  async function databaseStatus() {
    if (!pool) return 'not_configured';
    if (!dbProbe || Date.now() - dbProbeAt > 30000) {
      dbProbeAt = Date.now();
      dbProbe = pool.query('SELECT 1').then(() => 'connected', () => 'unavailable');
    }
    return dbProbe;
  }
  const srv = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      if (await world.handle(req, res)) return;
      const pathname = (req.url || '/').split('?')[0];
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end();
      }
      const asset = assets.get(pathname);
      if (asset) { if(asset.mime==='image/png')res.setHeader('Cache-Control','public, max-age=31536000, immutable'); res.writeHead(200, { 'Content-Type': asset.mime }); return res.end(req.method === 'HEAD' ? undefined : asset.body); }
      if (pathname === '/health' || pathname === '/api/health') {
        const database = await databaseStatus(), ok = database === 'connected';
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok, environment: APP_ENV, database,
          worldReady: ok, commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) }));
      }
      if (pathname === '/api/status') {
        let players = 0; for (const r of rooms.values()) players += r.size;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, environment: APP_ENV, rooms: rooms.size, players, battles: world.battles.size }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'not_found' }));
    } catch { if (!res.headersSent) res.writeHead(503); res.end(); }
  });
  const wss = new WebSocketServer({ server: srv, maxPayload: 512 * 1024 });
function broadcast(name) {
  const r = rooms.get(name); if (!r) return;
  const peers = []; for (const [w, p] of r) peers.push({ peer: w.id, presence: p });
  const msg = JSON.stringify({ t: 'peers', room: name, peers });
  for (const w of r.keys()) {
    if (w.readyState !== 1) continue;
    if (SIM_DELAY) setTimeout(() => { if (w.readyState === 1) w.send(msg); }, SIM_DELAY); else w.send(msg);
  }
}
function leave(ws, name) {
  const r = rooms.get(name); if (!r) return;
  r.delete(ws); ws.rooms.delete(name);
  if (!r.size) rooms.delete(name); else broadcast(name);
}

wss.on('connection', (ws,req) => {
  ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
  if(world.connectSocket(req,ws))return;
  ws.id = 'p' + (++seq).toString(36) + Math.random().toString(36).slice(2, 7);
  ws.rooms = new Set(); ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ t: 'hello', peer: ws.id }));
  ws.on('message', buf => {
    if(buf.length>16*1024){ws.close(1009);return;}
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    if (typeof m.room !== 'string' || !ROOM_RE.test(m.room)) return;
    if (m.t === 'join') {
      if (ws.rooms.size >= 16) return;
      if (!rooms.has(m.room)) rooms.set(m.room, new Map());
      const r = rooms.get(m.room); if (r.size >= 64) return;
      if (!r.has(ws)) r.set(ws, {});
      ws.rooms.add(m.room); broadcast(m.room);
    } else if (m.t === 'leave') {
      leave(ws, m.room);
    } else if (m.t === 'pres') {
      const r = rooms.get(m.room); if (!r || !r.has(ws)) return;
      const data = m.data && typeof m.data === 'object' && !Array.isArray(m.data) ? m.data : {};
      r.set(ws, data); broadcast(m.room);
    }
  });
  ws.on('close', () => { for (const n of [...ws.rooms]) leave(ws, n); });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const w of wss.clients) { if (!w.isAlive) { w.terminate(); continue; } w.isAlive = false; w.ping(); }
}, 30000);


  return { server: srv, world, async close() {
    clearInterval(heartbeat);
    await world.close();
    for (const client of wss.clients) client.terminate();
    await new Promise(resolve => wss.close(resolve));
    if (srv.listening) await new Promise(resolve => { srv.close(resolve); srv.closeIdleConnections?.(); });
    if (pool?.end) await pool.end();
  }};
}
if (require.main === module) {
  createApplication().then(app => {
    const port = process.env.PORT || 10000;
    app.server.listen(port, '0.0.0.0', () => console.log('Domination mundo-aberto na porta ' + port));
    let closing = false;
    const shutdown = async () => {
      if (closing) return; closing = true;
      const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
      await app.close(); clearTimeout(deadline); process.exit(0);
    };
    process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  }).catch(error => { console.error('Não foi possível iniciar o mundo aberto. Código: ' + (error.code || 'startup')); process.exit(1); });
}
module.exports = { createApplication };
