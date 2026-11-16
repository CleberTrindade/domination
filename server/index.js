// Servidor de salas do Domination (duelo online fora do Claude).
// Só repassa "presença": cada jogador publica seu estado numa sala e todos da sala recebem a lista.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 10000;
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const rooms = new Map(); // nome -> Map(ws -> presença)
let seq = 0;

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  let players = 0; for (const r of rooms.values()) players += r.size;
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, players }));
});
const wss = new WebSocketServer({ server: srv, maxPayload: 16 * 1024 });

function broadcast(name) {
  const r = rooms.get(name); if (!r) return;
  const peers = []; for (const [w, p] of r) peers.push({ peer: w.id, presence: p });
  const msg = JSON.stringify({ t: 'peers', room: name, peers });
  for (const w of r.keys()) if (w.readyState === 1) w.send(msg);
}
function leave(ws, name) {
  const r = rooms.get(name); if (!r) return;
  r.delete(ws); ws.rooms.delete(name);
  if (!r.size) rooms.delete(name); else broadcast(name);
}

wss.on('connection', ws => {
  ws.id = 'p' + (++seq).toString(36) + Math.random().toString(36).slice(2, 7);
  ws.rooms = new Set(); ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.send(JSON.stringify({ t: 'hello', peer: ws.id }));
  ws.on('message', buf => {
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

setInterval(() => {
  for (const w of wss.clients) { if (!w.isAlive) { w.terminate(); continue; } w.isAlive = false; w.ping(); }
}, 30000);

srv.listen(PORT, () => console.log('domination-ws na porta ' + PORT));
