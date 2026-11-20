'use strict';
const { randomUUID, randomInt } = require('node:crypto');
const { createBattle, restoreBattle } = require('./battle-engine');
const { HttpError, getPlayer, authenticate, publicPlayer, sessionToken } = require('./auth');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const LEASE_SECONDS = 90;
const DISCONNECT_MS = 30000;
function createWorldService(pool, { engineFactory = createBattle, startClock = true, now = Date.now } = {}) {
  const battles = new Map(), limits = new Map(), sockets = new Set();
  const instanceId = randomUUID();
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
  const ownerFor=(battle,playerId)=>battle.attackerId===playerId?1:battle.defenderId===playerId?2:0;
  function state(battle,owner=1) {
    return { id: battle.id, areaId: battle.areaId, areaName: battle.areaName, defenderName: battle.defenderName,
      attackerName:battle.attackerName,playerOwner:owner,defenderControlled:!!battle.defenderControlled,
      epoch:battle.epoch||(battle.epoch=randomUUID()),revision:battle.revision||0,
      status: battle.status, startedAt: battle.startedAt, snapshot: battle.engine.snapshot() };
  }
  function socketEvent(socket,type,data){
    if(socket.readyState!==1)return;
    if(socket.bufferedAmount>256*1024){socket.terminate();return;}
    socket.send(JSON.stringify({type,...data}));
  }
  function notify(type,data,playerId){
    for(const socket of sockets)if(!playerId||socket.player?.id===playerId)socketEvent(socket,type,data);
  }
  function publish(battle){
    const record=state(battle);
    for(const stream of battle.streams){
      if(stream.writableLength>256*1024){stream.destroy();continue;}
      event(stream,'state',{...record,playerOwner:stream.worldOwner});
    }
  }
  function updateDefense(battle){
    const controlled=now()<(battle.defenseUntil||0)||[...battle.streams].some(s=>s.worldOwner===2&&!s.destroyed);
    if(!!battle.defenderControlled===controlled)return;
    battle.defenderControlled=controlled;
    battle.revision=(battle.revision||0)+1;
    battle.engine.setDefenderControlled?.(controlled);
    publish(battle);notify('world_changed',{});
  }
  function event(stream, name, data) {
    if (!stream.destroyed && !stream.writableEnded) stream.write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n');
  }
  function detach(battle) {
    for (const stream of battle.streams) { event(stream, 'reconnect', {}); stream.end(); }
    battle.streams.clear(); battles.delete(battle.id);
  }
  async function checkpoint(battle) {
    if (battle.persisting) return;
    battle.persisting = true;
    try {
      const changed = await pool.query("UPDATE world_battles SET simulation=$1::jsonb,simulation_saved_at=now(),expires_at=now()+interval '90 seconds' WHERE id=$2 AND status='active' AND server_id=$3 RETURNING id", [JSON.stringify(battle.engine.checkpoint()), battle.id, instanceId]);
      if (!changed.rows.length) detach(battle);
      else battle.leaseAt = now();
    } finally { battle.persisting = false; }
  }
  async function recover(id, playerId) {
    return transaction(async db => {
      const row = (await db.query('SELECT * FROM world_battles WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new HttpError(404, 'Batalha não encontrada.');
      if(row.attacker_id!==playerId&&row.defender_id!==playerId)throw new HttpError(403,'Essa batalha pertence a outro comandante.');
      const participants={attackerId:row.attacker_id,defenderId:row.defender_id};
      if (battles.has(id)) return battles.get(id);
      if (row.status === 'active' && (!row.simulation || new Date(row.expires_at).getTime() < now())) {
        const status = row.simulation ? 'expired' : 'interrupted';
        const final = { status, reason: 'server_restart', areaId: row.area_id };
        await db.query('UPDATE world_battles SET status=$1,finished_at=now(),result=$2::jsonb WHERE id=$3', [status, JSON.stringify(final), id]);
        return { id, status, final,...participants };
      }
      if (row.status !== 'active') return { id, status: row.status,...participants, final: { status: row.status, reason: 'interrupted', ...row.result } };
      const engine = restoreBattle(row.simulation);
      const area = (await db.query('SELECT name FROM world_areas WHERE id=$1', [row.area_id])).rows[0];
      const defender = row.defender_id ? (await db.query('SELECT display_name FROM world_players WHERE id=$1', [row.defender_id])).rows[0]?.display_name : 'Guarnição da CPU';
      const attacker=(await db.query('SELECT display_name FROM world_players WHERE id=$1',[row.attacker_id])).rows[0]?.display_name;
      await db.query("UPDATE world_battles SET server_id=$1,expires_at=now()+interval '90 seconds' WHERE id=$2", [instanceId, id]);
      const battle = { id, areaId: row.area_id, areaName: area.name,...participants,attackerName:attacker, defenderName: defender, engine,
        status: 'active', startedAt: row.started_at, streams: new Set(), lastClientAt: now(), leaseAt: now(), broadcastAt: 0 };
      battles.set(id, battle); return battle;
    });
  }
  async function finish(battle, status, reason) {
    if (battle.settling || battle.status !== 'active') return;
    battle.settling = true;
    const stats = battle.engine.snapshot().stats;
    try {
      const final = await transaction(async db => {
        const row = (await db.query('SELECT * FROM world_battles WHERE id=$1 FOR UPDATE', [battle.id])).rows[0];
        if (!row || row.status !== 'active') return { status: row?.status || 'expired', reason: 'interrupted' };
        if (row.server_id !== instanceId) return { transferred: true };
        let finalStatus = new Date(row.expires_at).getTime() < now() ? 'expired' : status;
        if (finalStatus === 'won') {
          const changed = await db.query('UPDATE world_areas SET owner_id=$1,conquered_at=now(),version=version+1 WHERE id=$2 AND version=$3 RETURNING id', [row.attacker_id, row.area_id, row.area_version]);
          if (!changed.rows.length) finalStatus = 'expired';
        }
        const result = { status: finalStatus, reason, captures: stats.cap, kills: stats.kill, areaId: row.area_id, areaName: battle.areaName };
        await db.query('UPDATE world_battles SET status=$1,finished_at=now(),result=$2::jsonb WHERE id=$3', [finalStatus, JSON.stringify(result), battle.id]);
        return result;
      });
      if (final.transferred) { detach(battle); return; }
      battle.status = final.status; battle.final = final;
      for (const stream of battle.streams) { event(stream, 'result', final); stream.end(); }
      battle.streams.clear();
      battles.delete(battle.id);
      notify('world_changed',{});
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
      updateDefense(battle);
      // Account for timer drift without skipping collision/combat steps.
      for(let remaining=Math.min(dt,.25);remaining>1e-8;remaining-=.05)battle.engine.step(Math.min(.05,remaining));
      battle.revision=(battle.revision||0)+1;
      battle.broadcastAt += dt;
      if (battle.broadcastAt >= .1-1e-8) {
        battle.broadcastAt = Math.max(0,battle.broadcastAt-.1);
        publish(battle);
      }
      if ([...battle.streams].some(s=>s.worldOwner===1&&!s.destroyed)) battle.lastClientAt = now();
      if (now() - battle.leaseAt > 2000 && !battle.persisting) jobs.push(checkpoint(battle).catch(() => {}));
    }
    await Promise.all(jobs);
  }
  let clockAt=performance.now();
  const timer = startClock ? setInterval(() => { const at=performance.now(),dt=(at-clockAt)/1000;clockAt=at;tick(dt).catch(() => console.error('Falha temporária no controle de batalhas.')); }, 50) : null;
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
      const row = (await db.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,expires_at,simulation,server_id,simulation_saved_at) VALUES($1,$2,$3,$4,$5,'active',$6,now()+interval '90 seconds',$7::jsonb,$8,now()) RETURNING started_at", [id, area.id, player.id, area.owner_id, area.version, engine.snapshot().defenderShare, JSON.stringify(engine.checkpoint()), instanceId])).rows[0];
      return { id, areaId: area.id, areaName: area.name, attackerId: player.id,attackerName:player.display_name,defenderId:area.owner_id, defenderName: defense, engine,
        status: 'active', startedAt: row.started_at, streams: new Set(), lastClientAt: now(), leaseAt: now(), broadcastAt: 0 };
    });
    battles.set(record.id, record);
    notify('world_changed',{});
    if(record.defenderId)notify('under_attack',{battleId:record.id,areaId:record.areaId,areaName:record.areaName,attackerName:record.attackerName},record.defenderId);
    return state(record);
  }
  async function world(player) {
    await expire();
    const areas = (await pool.query(`SELECT a.id,a.name,a.ordinal,a.description,a.cpu_share,a.owner_id,a.conquered_at,
      p.display_name AS owner_name,b.id AS battle_id,b.attacker_id,attacker.display_name AS attacker_name
      FROM world_areas a LEFT JOIN world_players p ON p.id=a.owner_id
      LEFT JOIN world_battles b ON b.area_id=a.id AND b.status='active'
      LEFT JOIN world_players attacker ON attacker.id=b.attacker_id ORDER BY a.ordinal`)).rows;
    for(const area of areas)area.defender_controlled=!!battles.get(area.battle_id)?.defenderControlled;
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
  function execute(battle,player,command){
    const owner=ownerFor(battle,player.id);
    if(!owner)throw new HttpError(403,'Essa batalha pertence a outro comandante.');
    rate('command:'+player.id,40,1000);
    const accepted=!battle.settling&&battle.status==='active'&&battle.engine.command(command,owner);
    if(accepted){battle.revision=(battle.revision||0)+1;publish(battle);}
    return {accepted:!!accepted,message:accepted?'Ordem confirmada.':'Ordem recusada: confira suas tropas, a rota e a contagem inicial.',record:state(battle,owner)};
  }
  function connectSocket(req,socket){
    if(new URL(req.url,'http://localhost').pathname!=='/api/world/socket')return false;
    socket.on('error',()=>{});
    let queued=0,validatedAt=now(),chain=Promise.resolve();
    const authorized=(async()=>{
      if(!pool||closing)throw new HttpError(503,'O mundo está reiniciando.');
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw new HttpError(403,'Origem inválida.');
      if(req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Origem inválida.');
      const player=await getPlayer(pool,req);
      if(!player)throw new HttpError(401,'Entre na sua conta.');
      if(socket.readyState!==1)return null;
      if([...sockets].filter(s=>s.player.id===player.id).length>=5)throw new HttpError(429,'Muitas janelas abertas.');
      socket.player=player;socket.token=sessionToken(req);sockets.add(socket);
      socketEvent(socket,'ready',{});return player;
    })().catch(error=>{socketEvent(socket,'error',{message:error.status?error.message:'Conexão indisponível.'});socket.close(1008);return null;});
    socket.on('message',raw=>{
      if(++queued>32){socket.close(1008);return;}
      chain=chain.then(async()=>{
        let message;
        try{
          const player=await authorized;if(!player||socket.readyState!==1)return;
          if(now()-validatedAt>60000){
            const valid=await getPlayer(pool,req);if(!valid){socket.close(1008);return;}validatedAt=now();
          }
          message=JSON.parse(String(raw));
          if(message.type==='ping'){socketEvent(socket,'pong',{});return;}
          if(message.type!=='command'||!UUID.test(message.battleId)||!Number.isSafeInteger(message.requestId))throw new HttpError(400,'Comando inválido.');
          // The SSE/GET entry restores the battle. Live commands never wait for a DB query.
          const battle=battles.get(message.battleId);
          if(!battle)throw new HttpError(409,'Reconecte a batalha para enviar ordens.');
          socketEvent(socket,'ack',{requestId:message.requestId,battleId:battle.id,...execute(battle,player,message.command)});
        }catch(error){socketEvent(socket,'ack',{requestId:message?.requestId,battleId:message?.battleId,accepted:false,message:error.status?error.message:'Não foi possível confirmar a ordem.'});}
        finally{queued--;}
      }).catch(()=>{});
    });
    socket.on('close',()=>sockets.delete(socket));
    return true;
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
        const token=sessionToken(req);
        const result=await authenticate(pool, req, res, authAction, await readBody(req), !!process.env.RENDER || req.socket.encrypted);
        if(token){
          for(const socket of sockets)if(socket.token===token)socket.close(1008);
          for(const battle of battles.values()){
            let releasedDefense=false;
            for(const stream of battle.streams)if(stream.worldToken===token){battle.streams.delete(stream);if(stream.worldOwner===2)releasedDefense=true;stream.end();}
            if(releasedDefense){battle.defenseUntil=0;updateDefense(battle);}
          }
        }
        json(200,result); return true;
      }
      const player = await getPlayer(pool, req);
      if (pathname === '/api/world' && req.method === 'GET') { rate('world:' + ip, 180, 60000); json(200, await world(player)); return true; }
      if (!player) throw new HttpError(401, 'Entre na sua conta para disputar territórios.');
      const area = pathname.match(/^\/api\/world\/areas\/([a-z-]+)\/attack$/)?.[1];
      if (area && req.method === 'POST') { json(201, await start(player, area)); return true; }
      const match = pathname.match(/^\/api\/world\/battles\/([^/]+)(?:\/(events|commands|surrender|defend|release))?$/);
      if (!match || !UUID.test(match[1])) throw new HttpError(404, 'Rota não encontrada.');
      const [ , id, action ] = match;
      const battle = battles.get(id) || await recover(id, player.id);
      const owner=ownerFor(battle,player.id);
      if(!owner)throw new HttpError(403,'Essa batalha pertence a outro comandante.');
      if (battle.final) { json(200, { id,playerOwner:owner, status: battle.status, final: battle.final }); return true; }
      if (!action && req.method === 'GET') { json(200, state(battle,owner)); return true; }
      if(action==='defend'&&req.method==='POST'){
        if(owner!==2)throw new HttpError(403,'Somente o proprietário pode assumir a defesa.');
        battle.defenseUntil=now()+5000;updateDefense(battle);json(200,state(battle,owner));return true;
      }
      if(action==='release'&&req.method==='POST'){
        if(owner!==2)throw new HttpError(403,'Você não controla a defesa.');
        for(const stream of battle.streams)if(stream.worldOwner===2){battle.streams.delete(stream);stream.end();}
        battle.defenseUntil=0;updateDefense(battle);json(200,{released:true});return true;
      }
      if (action === 'events' && req.method === 'GET') {
        if ([...battle.streams].filter(s=>s.worldOwner===owner).length >= 3) throw new HttpError(429, 'A batalha já está aberta em outras janelas.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();res.worldOwner=owner;res.worldToken=sessionToken(req);battle.streams.add(res);
        if(owner===1)battle.lastClientAt=now();updateDefense(battle);event(res,'state',state(battle,owner));
        res.on('close',()=>{battle.streams.delete(res);if(owner===1&&![...battle.streams].some(s=>s.worldOwner===1))battle.lastClientAt=now();if(owner===2)battle.defenseUntil=0;updateDefense(battle);});return true;
      }
      if (action === 'commands' && req.method === 'POST') {
        const command = await readBody(req);
        json(200,execute(battle,player,command));return true;
      }
      if (action === 'surrender' && req.method === 'POST') {
        if(owner!==1)throw new HttpError(403,'Para deixar a defesa, devolva o controle à CPU.');
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
    for(const socket of sockets)socket.close(1012,'Servidor reiniciando');
    await Promise.all([...battles.values()].map(async b => {
      if (b.engine.result) await finish(b, b.engine.result, 'elimination');
      else { await checkpoint(b).catch(() => {}); detach(b); }
    }));
  }
  return { handle, tick, close, start, world, battles,connectSocket };
}
module.exports = { createWorldService, LEASE_SECONDS, DISCONNECT_MS };
