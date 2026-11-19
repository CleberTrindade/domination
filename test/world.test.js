'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../server');
const { createBattle } = require('../server/battle-engine');
const { migrate } = require('../server/database');
const { postgres } = require('./postgres');
const { WebSocket } = require('ws');
test('shared world API, real Postgres persistence and authoritative battle lifecycle', async t => {
  const database = await postgres(); const pool = database.pool;
  const engines = []; let clock = Date.now();
  const options = { startClock: false, now: () => clock, engineFactory(config) {
    const real = createBattle(config); let forced = null;
    const fixture = { step: real.step, command: real.command, snapshot: real.snapshot, checkpoint: real.checkpoint,
      get result() { return forced || real.result; }, finishAs(status) { forced = status; } };
    engines.push(fixture); return fixture;
  }};
  let app = await createApplication({ pool, worldOptions: options });
  async function listen() { await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + app.server.address().port; }
  let base = await listen();
  async function call(path, { cookie, method = 'GET', body, origin } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, json: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  const post = (path, cookie, body = {}) => call(path, { cookie, method: 'POST', body });
  let alice, bob, charlie;
  try {
    await t.test('seeds five areas and can migrate repeatedly without resetting ownership', async () => {
      const result = await call('/api/world'); assert.equal(result.status, 200); assert.equal(result.json.areas.length, 5);
      assert(result.json.areas.every(a => a.owner_id === null)); assert.equal(result.json.player, null);
      await migrate(pool); assert.equal((await call('/api/world')).json.areas.length, 5);
      assert.equal((await call('/api/health')).json.worldReady, true);
    });
    await t.test('registration, login and HttpOnly sessions persist without exposing secrets', async () => {
      const register = name => post('/api/auth/register', null, { username: name, name, password: 'integration-password-123' });
      const a = await register('alice'), b = await register('bob'), c = await register('charlie');
      assert.equal(a.status, 200); assert(a.cookie.includes('HttpOnly')); assert(a.cookie.includes('SameSite=Lax'));
      alice = a.cookie.split(';')[0]; bob = b.cookie.split(';')[0]; charlie = c.cookie.split(';')[0];
      assert.equal((await register('alice')).status, 409);
      assert.equal((await post('/api/auth/login', null, { username: 'alice', password: 'wrong-password' })).status, 401);
      const row = (await pool.query("SELECT password_hash FROM world_players WHERE username='alice'")).rows[0];
      assert(!row.password_hash.includes('integration-password'));
      const world = await call('/api/world', { cookie: alice }); assert.equal(world.json.player.username, 'alice');
      assert(!JSON.stringify(world.json).includes('password_hash')); assert(!JSON.stringify(world.json).includes(alice.split('=')[1]));
    });
    await t.test('rejects unauthenticated attacks, cross-site mutations and client victory claims', async () => {
      assert.equal((await post('/api/world/areas/se-litoral-sul/attack')).status, 401);
      assert.equal((await call('/api/world/areas/se-litoral-sul/attack', { cookie: alice, method: 'POST', body: {}, origin: 'https://other.invalid' })).status, 403);
      assert.equal((await post('/api/world/battles/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/result', alice, { result: 'won' })).status, 404);
      assert.equal((await post('/api/auth/register', null, { name: 'z'.repeat(9000) })).status, 413);
    });
    await t.test('only one concurrent attack can reserve an area', async () => {
      const results = await Promise.all([post('/api/world/areas/se-litoral-sul/attack', alice), post('/api/world/areas/se-litoral-sul/attack', bob)]);
      assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
      const winner = results.findIndex(r => r.status === 201), cookie = winner === 0 ? alice : bob, opponent = winner === 0 ? bob : alice;
      const battle = results[winner].json;
      assert(battle.snapshot.defenderShare >= .30 && battle.snapshot.defenderShare <= .40);
      assert.equal((await call('/api/world/battles/' + battle.id, { cookie: opponent })).status, 403);
      assert.equal((await post('/api/world/battles/' + battle.id + '/surrender', cookie)).json.status, 'abandoned');
      assert.equal((await call('/api/world')).json.areas[0].owner_id, null);
    });
    await t.test('one player cannot reserve two areas simultaneously', async () => {
      const results = await Promise.all([post('/api/world/areas/se-agreste/attack', charlie), post('/api/world/areas/se-alto-sertao/attack', charlie)]);
      assert.deepEqual(results.map(r => r.status).sort(), [201,409]);
      const battle = results.find(r => r.status === 201).json;
      await post('/api/world/battles/' + battle.id + '/surrender', charlie);
    });
    await t.test('server-confirmed victories transfer ownership, then defense begins at half the map', async () => {
      const first = (await post('/api/world/areas/se-aracaju/attack', alice)).json;
      engines.at(-1).finishAs('won'); await app.world.tick();
      const aliceId = (await call('/api/world', { cookie: alice })).json.player.id;
      let area = (await call('/api/world')).json.areas.find(a => a.id === 'se-aracaju'); assert.equal(area.owner_id, aliceId);
      assert.equal((await post('/api/world/areas/se-aracaju/attack', alice)).status, 409);
      const second = (await post('/api/world/areas/se-aracaju/attack', bob)).json;
      assert.equal(second.defenderName, 'alice'); assert(Math.abs(second.snapshot.defenderShare - .5) < .013);
      engines.at(-1).finishAs('lost'); await app.world.tick();
      area = (await call('/api/world')).json.areas.find(a => a.id === 'se-aracaju'); assert.equal(area.owner_id, aliceId);
      const third = await post('/api/world/areas/se-aracaju/attack', bob); assert.equal(third.status, 201);
      engines.at(-1).finishAs('won'); await app.world.tick();
      const bobId = (await call('/api/world', { cookie: bob })).json.player.id;
      const map = (await call('/api/world')).json; assert.equal(map.areas.find(a => a.id === 'se-aracaju').owner_id, bobId);
      assert.equal(map.ranking[0].id, bobId); assert(map.history.some(h => h.id === first.id && h.status === 'won'));
      // A repeated request cannot apply the same victory twice.
      const version = (await pool.query("SELECT version FROM world_areas WHERE id='se-aracaju'")).rows[0].version;
      assert.equal(version, 2); await app.world.tick(); assert.equal((await pool.query("SELECT version FROM world_areas WHERE id='se-aracaju'")).rows[0].version, 2);
    });
    await t.test('SSE reconnects to the same battle and disconnect timeout releases its reservation', async () => {
      clock = Date.now();
      const record = (await post('/api/world/areas/se-sao-francisco/attack', charlie)).json;
      const controller = new AbortController();
      const response = await fetch(base + '/api/world/battles/' + record.id + '/events', { headers: { Cookie: charlie }, signal: controller.signal });
      assert.equal(response.status, 200);
      const reader = response.body.getReader(); assert(Buffer.from((await reader.read()).value).toString().includes('event: state'));
      assert.equal(app.world.battles.get(record.id).streams.size, 1);
      controller.abort(); await new Promise(r => setTimeout(r, 20));
      clock += 10000; await app.world.tick();
      assert.equal((await call('/api/world/battles/' + record.id, { cookie: charlie })).json.status, 'active');
      const secondController = new AbortController();
      const resumed = await fetch(base + '/api/world/battles/' + record.id + '/events', { headers: { Cookie: charlie }, signal: secondController.signal });
      assert.equal(resumed.status, 200); await resumed.body.getReader().read(); secondController.abort(); await new Promise(r => setTimeout(r, 20));
      clock += 31000; await app.world.tick();
      const final = await call('/api/world/battles/' + record.id, { cookie: charlie }); assert.equal(final.json.status, 'abandoned');
      assert.equal((await call('/api/world')).json.areas.find(a => a.id === 'se-sao-francisco').owner_id, null);
      clock = Date.now();
    });
    await t.test('stale leases cannot transfer ownership and startup keeps conquered areas and sessions', async () => {
      const record = (await post('/api/world/areas/se-agreste/attack', alice)).json;
      await pool.query("UPDATE world_battles SET expires_at=now()-interval '1 second' WHERE id=$1", [record.id]);
      engines.at(-1).finishAs('won'); await app.world.tick();
      assert.equal((await call('/api/world/battles/' + record.id, { cookie: alice })).json.status, 'expired');
      assert.equal((await call('/api/world')).json.areas.find(a => a.id === 'se-agreste').owner_id, null);
      const active = await post('/api/world/areas/se-alto-sertao/attack', bob); assert.equal(active.status, 201);
      await app.close(); app = await createApplication({ pool, worldOptions: options }); base = await listen();
      const result = await call('/api/world', { cookie: bob }); assert.equal(result.json.player.username, 'bob');
      assert.equal(result.json.areas.find(a => a.id === 'se-aracaju').owner_id, result.json.player.id);
      const recovered = await call('/api/world/battles/' + active.json.id, { cookie: bob });
      assert.equal(recovered.json.status, 'active');
      assert.equal(recovered.json.snapshot.sites.length, 17);
      await post('/api/world/battles/' + active.json.id + '/surrender', bob);
      const login = await post('/api/auth/login', null, { username: 'alice', password: 'integration-password-123' }); assert.equal(login.status, 200);
    });
    await t.test('an orphan from the earlier build closes immediately without an endless 90-second error', async () => {
      const record = await post('/api/world/areas/se-sao-francisco/attack', charlie); assert.equal(record.status, 201);
      // Reproduce the original failure: an active reservation with no in-memory state or checkpoint.
      app.world.battles.delete(record.json.id);
      await pool.query('UPDATE world_battles SET simulation=NULL WHERE id=$1', [record.json.id]);
      const recovered = await call('/api/world/battles/' + record.json.id, { cookie: charlie });
      assert.equal(recovered.status, 200); assert.equal(recovered.json.final.status, 'interrupted');
      const result = await call('/api/world'); assert.equal(result.json.areas.find(a => a.id === 'se-sao-francisco').battle_id, null);
    });
    await t.test('a replacement instance resumes the battle and rejects a victory from the old instance', async () => {
      const active = await post('/api/world/areas/se-alto-sertao/attack', charlie); assert.equal(active.status, 201);
      const oldApp = app, oldEngine = engines.at(-1);
      const replacement = await createApplication({ pool, worldOptions: options });
      await new Promise(resolve => replacement.server.listen(0, '127.0.0.1', resolve));
      const replacementBase = 'http://127.0.0.1:' + replacement.server.address().port;
      try {
        const response = await fetch(replacementBase + '/api/world/battles/' + active.json.id, { headers: { Cookie: charlie } });
        assert.equal(response.status, 200); assert.equal((await response.json()).status, 'active');
        oldEngine.finishAs('won'); await oldApp.world.tick();
        assert.equal(oldApp.world.battles.has(active.json.id), false);
        assert.equal((await pool.query("SELECT owner_id FROM world_areas WHERE id='se-alto-sertao'")).rows[0].owner_id, null);
        const surrender = await fetch(replacementBase + '/api/world/battles/' + active.json.id + '/surrender', { method: 'POST', headers: { Cookie: charlie, 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal((await surrender.json()).status, 'abandoned');
      } finally { await oldApp.close(); app = replacement; base = replacementBase; }
    });
    await t.test('classic online rooms still communicate independently of world battles', async () => {
      const peers = [];
      const next = (ws, predicate) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Room message timed out')), 3000);
        function onMessage(raw) { const m = JSON.parse(raw); if (predicate(m)) { clearTimeout(timer); ws.off('message', onMessage); resolve(m); } }
        ws.on('message', onMessage); ws.once('error', reject);
      });
      try {
        const a = new WebSocket(base.replace('http:', 'ws:')), b = new WebSocket(base.replace('http:', 'ws:'));
        peers.push(a,b); await Promise.all(peers.map(ws => next(ws, m => m.t === 'hello')));
        let wait = next(a, m => m.t === 'peers' && m.peers.length === 1); a.send(JSON.stringify({ t: 'join', room: 'classic-test' })); await wait;
        wait = next(a, m => m.t === 'peers' && m.peers.length === 2); b.send(JSON.stringify({ t: 'join', room: 'classic-test' })); await wait;
        wait = next(a, m => m.peers?.some(p => p.presence.test === 'ok')); b.send(JSON.stringify({ t: 'pres', room: 'classic-test', data: { test: 'ok' } })); assert.equal((await wait).peers.length, 2);
      } finally { for (const ws of peers) ws.terminate(); }
    });
  } finally { await app.close(); await database.destroy(); }
});
