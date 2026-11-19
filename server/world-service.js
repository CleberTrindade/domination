'use strict';
const { randomUUID, randomInt } = require('node:crypto');
const { createBattle } = require('./battle-engine');
const { HttpError, getPlayer, authenticate, publicPlayer } = require('./auth');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LEASE_SECONDS = 90;
const DISCONNECT_MS = 30000;
function createWorldService(pool, { engineFactory = createBattle, startClock = true, now = Date.now } = {}) {
  const battles = new Map(), limits = new Map();
  let closing = false;
  function rate(key, max, windowMs) {
    const time = now();
    let entry = limits.get(key);
    if (!entry || entry.until < time) { entry = { n: 0, until: time + windowMs }; limits.set(key, entry); }
    if (limits.size > 10000) limits.delete(limits.keys().next().value);
    if (++entry.n > max) throw new HttpError(429, 'Muitas tentativas. Aguarde um pouco e tente novamente.');
  }
  async function transaction(fn) {
    const db = await pool.connect();
    try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  async function expire(db = pool) {
    await db.query("UPDATE world_battles SET status='expired',finished_at=now(),result='{}'::jsonb WHERE status='active' AND expires_at<now()");
  }
  function state(battle) {
    return { id: battle.id, areaId: battle.areaId, areaName: battle.areaName, defenderName: battle.defenderName,
      status: battle.status, startedAt: battle.startedAt, snapshot: battle.engine.snapshot() };
  }
  function event(stream, name, data) {
    if (!stream.destroyed && !stream.writableEnded) stream.write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n');
  }
  async function finish(battle, status, reason) {
    if (battle.settling || battle.status !== 'active') return;
    battle.settling = true;
    const stats = battle.engine.snapshot().stats;
    try {
      const final = await transaction(async db => {
        const row = (await db.query('SELECT * FROM world_battles WHERE id=$1 FOR UPDATE', [battle.id])).rows[0];
        if (!row || row.status !== 'active') return { status: row?.status || 'expired', reason: 'interrupted' };
        let finalStatus = new Date(row.expires_at).getTime() < now() ? 'expired' : status;
        if (finalStatus === 'won') {
          const changed = await db.query('UPDATE world_areas SET owner_id=$1,conquered_at=now(),version=version+1 WHERE id=$2 AND version=$3 RETURNING id', [row.attacker_id, row.area_id, row.area_version]);
          if (!changed.rows.length) finalStatus = 'expired';
        }
        const result = { status: finalStatus, reason, captures: stats.cap, kills: stats.kill, areaId: row.area_id, areaName: battle.areaName };
        await db.query('UPDATE world_battles SET status=$1,finished_at=now(),result=$2::jsonb WHERE id=$3', [finalStatus, JSON.stringify(result), battle.id]);
        return result;
      });
      battle.status = final.status; battle.final = final;
      for (const stream of battle.streams) { event(stream, 'result', final); stream.end(); }
      battle.streams.clear();
      battles.delete(battle.id);
    } catch (error) {
      // Keep the area reserved while transient database failures are retried.
      for (const stream of battle.streams) event(stream, 'saving', { message: 'Salvando o resultado…' });
      battle.retryAt = now() + 3000;
      console.error('Não foi possível concluir uma batalha. Nova tentativa agendada.');
    } finally { battle.settling = false; }
  }
  async function tick(dt = .05) {
    const jobs = [];
    for (const battle of battles.values()) {
      if (battle.settling || battle.status !== 'active') continue;
      if (battle.retryAt && now() < battle.retryAt) continue;
      if (battle.engine.result) { jobs.push(finish(battle, battle.engine.result, battle.engine.snapshot().reason || 'elimination')); continue; }
      if (now() - battle.lastClientAt > DISCONNECT_MS) { jobs.push(finish(battle, 'abandoned', 'disconnected')); continue; }
      battle.engine.step(dt);
      battle.broadcastAt += dt;
      if (battle.broadcastAt >= .2) {
        battle.broadcastAt = 0;
        const snapshot = state(battle);
        for (const stream of battle.streams) {
          if (stream.writableLength > 256 * 1024) { stream.destroy(); continue; }
          event(stream, 'state', snapshot);
        }
      }
      if (battle.streams.size) battle.lastClientAt = now();
      if (now() - battle.leaseAt > 15000 && !battle.renewing) {
        battle.renewing = true;
        jobs.push(pool.query("UPDATE world_battles SET expires_at=now()+interval '90 seconds' WHERE id=$1 AND status='active' RETURNING id", [battle.id])
          .then(r => { if (!r.rows.length) return finish(battle, 'expired', 'interrupted'); battle.leaseAt = now(); })
          .catch(() => {}).finally(() => { battle.renewing = false; }));
      }
    }
    await Promise.all(jobs);
  }
  const timer = startClock ? setInterval(() => { tick().catch(() => console.error('Falha temporária no controle de batalhas.')); }, 50) : null;
  timer?.unref();
  async function start(player, areaId) {
    if (closing) throw new HttpError(503, 'O servidor está reiniciando. Tente novamente em instantes.');
    rate('start:' + player.id, 8, 60000);
    const record = await transaction(async db => {
      // Lock the player before the area, making concurrent start requests deterministic.
      await db.query('SELECT id FROM world_players WHERE id=$1 FOR UPDATE', [player.id]);
      await expire(db);
      if ((await db.query("SELECT id FROM world_battles WHERE attacker_id=$1 AND status='active'", [player.id])).rows.length) throw new HttpError(409, 'Você já tem uma batalha em andamento. Retome-a antes de atacar outra área.');
      const area = (await db.query('SELECT * FROM world_areas WHERE id=$1 FOR UPDATE', [areaId])).rows[0];
      if (!area) throw new HttpError(404, 'Área não encontrada.');
      if (area.owner_id === player.id) throw new HttpError(409, 'Essa área já pertence a você.');
      if ((await db.query("SELECT id FROM world_battles WHERE area_id=$1 AND status='active'", [areaId])).rows.length) throw new HttpError(409, 'Essa área está em disputa. Aguarde o fim da batalha.');
      const id = randomUUID(), share = area.owner_id ? .50 : area.cpu_share;
      const engine = engineFactory({ share, difficulty: area.ordinal, seed: randomInt(1, 2147483647) });
      const defense = area.owner_id ? (await db.query('SELECT display_name FROM world_players WHERE id=$1', [area.owner_id])).rows[0]?.display_name : 'Guarnição da CPU';
      const row = (await db.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,expires_at) VALUES($1,$2,$3,$4,$5,'active',$6,now()+interval '90 seconds') RETURNING started_at", [id, area.id, player.id, area.owner_id, area.version, engine.snapshot().defenderShare])).rows[0];
      return { id, areaId: area.id, areaName: area.name, attackerId: player.id, defenderName: defense, engine,
        status: 'active', startedAt: row.started_at, streams: new Set(), lastClientAt: now(), leaseAt: now(), broadcastAt: 0 };
    });
    battles.set(record.id, record);
    return state(record);
  }
  async function world(player) {
    await expire();
    const areas = (await pool.query(`SELECT a.id,a.name,a.ordinal,a.description,a.cpu_share,a.owner_id,a.conquered_at,
      p.display_name AS owner_name,b.id AS battle_id,b.attacker_id
      FROM world_areas a LEFT JOIN world_players p ON p.id=a.owner_id
      LEFT JOIN world_battles b ON b.area_id=a.id AND b.status='active' ORDER BY a.ordinal`)).rows;
    const ranking = (await pool.query(`SELECT p.id,p.display_name AS name,count(*)::int AS areas
      FROM world_players p JOIN world_areas a ON a.owner_id=p.id GROUP BY p.id,p.display_name ORDER BY areas DESC,p.display_name LIMIT 10`)).rows;
    const history = (await pool.query(`SELECT b.id,b.status,b.finished_at,a.name AS area_name,p.display_name AS attacker_name,d.display_name AS defender_name
      FROM world_battles b JOIN world_areas a ON a.id=b.area_id JOIN world_players p ON p.id=b.attacker_id
      LEFT JOIN world_players d ON d.id=b.defender_id WHERE b.status<>'active' ORDER BY b.finished_at DESC LIMIT 12`)).rows;
    return { player: publicPlayer(player), country: 'Brasil', region: 'Nordeste', state: 'Sergipe', stateId: 'SE', areas, ranking, history,
      activeBattle: areas.find(a => a.attacker_id === player?.id)?.battle_id || null };
  }
  async function readBody(req) {
    return new Promise((resolve, reject) => {
      let bytes = 0, text = '', exceeded = false;
      req.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8192) { if (!exceeded) reject(new HttpError(413, 'Solicitação muito grande.')); exceeded = true; return; }
        text += chunk.toString();
      });
      req.on('error', () => reject(new HttpError(400, 'Solicitação incompleta.')));
      req.on('end', () => {
        if (exceeded) return;
        try {
          const value = JSON.parse(text || '{}');
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
          resolve(value);
        } catch { reject(new HttpError(400, 'Solicitação inválida.')); }
      });
    });
  }
  async function handle(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/api/world') && !pathname.startsWith('/api/auth')) return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (!pool) throw new HttpError(503, 'O mundo está indisponível. Tente novamente em instantes.');
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Envie uma solicitação JSON.');
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new HttpError(403, 'Origem da solicitação inválida.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Origem da solicitação inválida.');
      }
      const authAction = pathname.match(/^\/api\/auth\/(register|login|logout)$/)?.[1];
      if (authAction && req.method === 'POST') {
        rate('auth:' + ip, 30, 15 * 60000);
        json(200, await authenticate(pool, req, res, authAction, await readBody(req), !!process.env.RENDER || req.socket.encrypted)); return true;
      }
      const player = await getPlayer(pool, req);
      if (pathname === '/api/world' && req.method === 'GET') { rate('world:' + ip, 180, 60000); json(200, await world(player)); return true; }
      if (!player) throw new HttpError(401, 'Entre na sua conta para disputar territórios.');
      const area = pathname.match(/^\/api\/world\/areas\/([a-z-]+)\/attack$/)?.[1];
      if (area && req.method === 'POST') { json(201, await start(player, area)); return true; }
      const match = pathname.match(/^\/api\/world\/battles\/([^/]+)(?:\/(events|commands|surrender))?$/);
      if (!match || !UUID.test(match[1])) throw new HttpError(404, 'Rota não encontrada.');
      const [ , id, action ] = match;
      const battle = battles.get(id);
      if (!battle) {
        const found = (await pool.query('SELECT attacker_id,status,result,expires_at FROM world_battles WHERE id=$1', [id])).rows[0];
        if (!found || found.attacker_id !== player.id) throw new HttpError(404, 'Batalha não encontrada.');
        if (found.status === 'active') throw new HttpError(409, 'Essa batalha está sendo encerrada após uma reconexão do servidor. Aguarde até 90 segundos.');
        json(200, { id, status: found.status, final: found.result || { status: found.status, reason: 'interrupted' } }); return true;
      }
      if (battle.attackerId !== player.id) throw new HttpError(403, 'Essa batalha pertence a outro comandante.');
      if (!action && req.method === 'GET') { json(200, state(battle)); return true; }
      if (action === 'events' && req.method === 'GET') {
        if (battle.streams.size >= 3) throw new HttpError(429, 'A batalha já está aberta em outras janelas.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders(); battle.streams.add(res); battle.lastClientAt = now(); event(res, 'state', state(battle));
        res.on('close', () => { battle.streams.delete(res); if (!battle.streams.size) battle.lastClientAt = now(); }); return true;
      }
      if (action === 'commands' && req.method === 'POST') {
        rate('command:' + player.id, 40, 1000);
        const command = await readBody(req);
        const accepted = !battle.settling && battle.engine.command(command);
        json(200, { accepted: !!accepted }); return true;
      }
      if (action === 'surrender' && req.method === 'POST') {
        await finish(battle, 'abandoned', 'surrender');
        if (battle.status === 'active') throw new HttpError(503, 'Ainda não foi possível salvar a desistência. Tente novamente.');
        json(200, battle.final); return true;
      }
      throw new HttpError(404, 'Rota não encontrada.');
    } catch (error) {
      if (!error.status) console.error('Falha temporária na API do mundo aberto.');
      json(error.status || 503, { error: error.status ? error.message : 'O mundo está temporariamente indisponível. Tente novamente.' });
      return true;
    }
  }
  async function close() {
    closing = true; if (timer) clearInterval(timer);
    await Promise.all([...battles.values()].map(b => finish(b, 'interrupted', 'server_restart')));
  }
  return { handle, tick, close, start, world, battles };
}
module.exports = { createWorldService, LEASE_SECONDS, DISCONNECT_MS };
