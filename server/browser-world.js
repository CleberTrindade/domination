'use strict';
const {randomUUID,randomInt}=require('node:crypto');
const engineFactory=require('./battle-engine');
const {verifyBrowserBattle,MAX_FRAMES}=require('../shared/browser-battle');
const {HttpError,getPlayer,authenticate,publicPlayer,sessionToken}=require('./auth');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DISCONNECT_MS=30000;
function createWorldService(pool,{startClock=true,now=Date.now}={}){
  const battles=new Map(),sockets=new Set(),sessions=new Map(),limits=new Map();
  let closing=false,startQueue=Promise.resolve();
  function rate(key,max,ms){const at=now();let entry=limits.get(key);if(!entry||entry.until<at){entry={n:0,until:at+ms};limits.set(key,entry);}if(limits.size>10000)limits.delete(limits.keys().next().value);if(++entry.n>max)throw new HttpError(429,'Muitas ordens. Aguarde um instante.');}
  async function playerFor(req){
    const token=sessionToken(req);if(!token)return null;
    const cached=sessions.get(token);if(cached&&cached.until>now())return cached.player;
    const player=await getPlayer(pool,req);if(player)sessions.set(token,{player,until:now()+60000});
    if(sessions.size>10000)sessions.delete(sessions.keys().next().value);return player;
  }
  const ownerFor=(battle,id)=>battle.attackerId===id?1:battle.defenderId===id?2:0;
  function state(battle,owner=1,full=false){
    const record={id:battle.id,areaId:battle.areaId,areaName:battle.areaName,attackerName:battle.attackerName,defenderName:battle.defenderName,
      playerOwner:owner,defenderControlled:!!battle.defenderControlled,status:battle.status,startedAt:battle.startedAt,
      epoch:battle.id,revision:battle.revision,mode:'browser',config:battle.config,snapshot:battle.snapshot};
    if(full&&owner===1){record.resume=battle.resume;record.authorizedInputs=[...battle.inputs.values()];}
    return record;
  }
  function event(stream,type,data){if(!stream.destroyed&&!stream.writableEnded)stream.write('event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n');}
  function socketEvent(socket,type,data){if(socket.readyState!==1)return;if(socket.bufferedAmount>512*1024){socket.terminate();return;}socket.send(JSON.stringify({type,...data}));}
  function notify(type,data,playerId){for(const socket of sockets)if(!playerId||socket.player.id===playerId)socketEvent(socket,type,data);}
  function publish(battle){for(const stream of battle.streams){if(stream.writableLength>512*1024){stream.destroy();continue;}event(stream,'state',state(battle,stream.worldOwner));}}
  function ticket(battle,input){
    if(battle.inputs.size>=2500)throw new HttpError(429,'Limite de ordens desta batalha atingido.');
    battle.inputs.set(input.nonce,input);
    for(const stream of battle.streams)if(stream.worldOwner===1)event(stream,'input',input);
  }
  function updateDefense(battle){
    if(battle.status!=='active')return;
    const controlled=now()<(battle.defenseUntil||0)||[...battle.streams].some(stream=>stream.worldOwner===2&&!stream.destroyed);
    if(controlled===!!battle.defenderControlled)return;
    battle.defenderControlled=controlled;battle.revision++;
    ticket(battle,{nonce:randomUUID(),kind:'control',controlled});publish(battle);notify('world_changed',{});
  }
  async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
  async function finish(battle,status,reason,stats={}){
    if(battle.final)return battle.final;
    if(battle.finishing)return battle.finishing;
    battle.finishing=(async()=>{
      try{
        const final=await transaction(async db=>{
          const existing=(await db.query('SELECT status,result FROM world_battles WHERE id=$1 FOR UPDATE',[battle.id])).rows[0];
          if(existing&&existing.status!=='active')return existing.result||{status:existing.status};
          const area=(await db.query('SELECT version FROM world_areas WHERE id=$1 FOR UPDATE',[battle.areaId])).rows[0];
          const finalStatus=area?.version===battle.areaVersion?status:'expired';
          const result={status:finalStatus,reason,areaId:battle.areaId,areaName:battle.areaName,captures:stats.cap||0,kills:stats.kill||0};
          if(finalStatus==='won')await db.query('UPDATE world_areas SET owner_id=$1,conquered_at=now(),version=version+1 WHERE id=$2 AND version=$3',[battle.attackerId,battle.areaId,battle.areaVersion]);
          await db.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,started_at,finished_at,expires_at,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),$9::jsonb)",
            [battle.id,battle.areaId,battle.attackerId,battle.defenderId,battle.areaVersion,finalStatus,battle.defenseShare,battle.startedAt,JSON.stringify(result)]);
          return result;
        });
        battle.status=final.status;battle.final=final;
        for(const stream of battle.streams){event(stream,'result',final);stream.end();}battle.streams.clear();
        battle.inputs.clear();battle.resume=null;notify('world_changed',{});return final;
      }catch(error){for(const stream of battle.streams)event(stream,'saving',{message:'Salvando o resultado…'});throw error;}
      finally{battle.finishing=null;}
    })();return battle.finishing;
  }
  async function lookup(id,playerId){
    let battle=battles.get(id);if(battle){if(!ownerFor(battle,playerId))throw new HttpError(403,'Essa batalha pertence a outro comandante.');return battle;}
    const row=(await pool.query('SELECT * FROM world_battles WHERE id=$1',[id])).rows[0];
    if(!row)throw new HttpError(404,'A batalha não está mais disponível. Volte ao mapa para iniciar outra.');
    battle={id,attackerId:row.attacker_id,defenderId:row.defender_id,status:row.status,final:row.result};
    if(!ownerFor(battle,playerId))throw new HttpError(403,'Essa batalha pertence a outro comandante.');
    return battle;
  }
  async function initialize(){
    if(!pool)return;
    // Legacy server-simulated matches cannot be resumed with a browser input log.
    await pool.query("UPDATE world_battles SET status='interrupted',finished_at=now(),simulation=NULL,result=jsonb_build_object('status','interrupted','reason','server_restart','areaId',area_id) WHERE status='active'");
  }
  async function start(player,areaId){
    if(closing)throw new HttpError(503,'O servidor está reiniciando.');rate('start:'+player.id,8,60000);
    const task=startQueue.then(async()=>{
      for(const battle of battles.values())if(battle.status==='active'){
        if(battle.attackerId===player.id)throw new HttpError(409,'Você já tem uma batalha em andamento.');
        if(battle.areaId===areaId)throw new HttpError(409,'Essa área está em disputa.');
      }
      const area=(await pool.query('SELECT a.*,p.display_name AS owner_name FROM world_areas a LEFT JOIN world_players p ON p.id=a.owner_id WHERE a.id=$1',[areaId])).rows[0];
      if(!area)throw new HttpError(404,'Área não encontrada.');if(area.owner_id===player.id)throw new HttpError(409,'Essa área já pertence a você.');
      const config={share:area.owner_id ? .50 : area.cpu_share,difficulty:area.ordinal,seed:randomInt(1,2147483647)};
      const initial=engineFactory.createBattle(config).snapshot();
      const battle={id:randomUUID(),areaId:area.id,areaName:area.name,areaVersion:area.version,attackerId:player.id,attackerName:player.display_name,
        defenderId:area.owner_id,defenderName:area.owner_name||'Guarnição da CPU',config,snapshot:initial,defenseShare:initial.defenderShare,
        status:'active',startedAt:new Date(now()).toISOString(),lastClientAt:now(),lastHostAt:now(),revision:0,streams:new Set(),inputs:new Map(),resume:null};
      battles.set(battle.id,battle);notify('world_changed',{});
      if(battle.defenderId)notify('under_attack',{battleId:battle.id,areaId:battle.areaId,areaName:battle.areaName,attackerName:battle.attackerName},battle.defenderId);
      return state(battle,1,true);
    });startQueue=task.catch(()=>{});return task;
  }
  async function world(player){
    const areas=(await pool.query('SELECT a.*,p.display_name AS owner_name FROM world_areas a LEFT JOIN world_players p ON p.id=a.owner_id ORDER BY a.ordinal')).rows;
    for(const area of areas){const battle=[...battles.values()].find(b=>b.areaId===area.id&&b.status==='active');Object.assign(area,{battle_id:battle?.id||null,attacker_id:battle?.attackerId||null,attacker_name:battle?.attackerName||null,defender_controlled:!!battle?.defenderControlled});}
    const ranking=(await pool.query('SELECT p.id,p.display_name AS name,count(*)::int AS areas FROM world_players p JOIN world_areas a ON a.owner_id=p.id GROUP BY p.id,p.display_name ORDER BY areas DESC,p.display_name LIMIT 10')).rows;
    const history=(await pool.query("SELECT b.id,b.status,b.finished_at,a.name AS area_name,p.display_name AS attacker_name,d.display_name AS defender_name FROM world_battles b JOIN world_areas a ON a.id=b.area_id JOIN world_players p ON p.id=b.attacker_id LEFT JOIN world_players d ON d.id=b.defender_id WHERE b.status<>'active' ORDER BY b.finished_at DESC LIMIT 12")).rows;
    return {player:publicPlayer(player),country:'Brasil',region:'Nordeste',state:'Sergipe',stateId:'SE',areas,ranking,history,activeBattle:areas.find(a=>a.attacker_id===player?.id)?.battle_id||null};
  }
  function execute(battle,player,command){
    const owner=ownerFor(battle,player.id);if(!owner)throw new HttpError(403,'Essa batalha pertence a outro comandante.');
    if(battle.status!=='active'||battle.finishing)throw new HttpError(409,'A batalha está sendo encerrada.');
    if(!UUID.test(command?.nonce))throw new HttpError(400,'Identificador da ordem inválido.');
    const prior=battle.inputs.get(command.nonce);if(prior){if(prior.owner!==owner)throw new HttpError(403,'Ordem inválida.');return {accepted:true,input:prior};}
    rate('command:'+player.id,40,1000);
    if(owner===2&&!battle.defenderControlled)throw new HttpError(409,'Assuma a defesa antes de enviar ordens.');
    const site=id=>Number.isInteger(id)&&id>=0&&id<17;
    let clean;
    if(command.type==='send'&&site(command.target)&&Array.isArray(command.sources)&&command.sources.length<=17&&command.sources.every(site))clean={type:'send',sources:[...new Set(command.sources)],target:command.target};
    else if(command.type==='drop'&&site(command.site))clean={type:'drop',site:command.site};
    else throw new HttpError(400,'Ordem inválida.');
    const input={nonce:command.nonce,kind:'command',owner,command:clean};ticket(battle,input);
    return {accepted:true,message:'Ordem encaminhada.',input};
  }
  function relay(battle,player,data){
    if(ownerFor(battle,player.id)!==1)throw new HttpError(403,'Somente o navegador atacante pode transmitir a simulação.');
    if(battle.status!=='active'||battle.finishing)return;
    rate('relay:'+player.id,40,1000);
    const snapshot=data.snapshot;
    if(!snapshot||!Number.isFinite(snapshot.time)||snapshot.time<0||snapshot.time>361||snapshot.sites?.length!==17||!Array.isArray(snapshot.units)||snapshot.units.length>512)throw new HttpError(400,'Estado inválido.');
    battle.snapshot=snapshot;battle.lastHostAt=now();battle.lastClientAt=now();battle.revision++;
    if(data.resume&&Number.isInteger(data.resume.frames)&&data.resume.frames>=0&&data.resume.frames<=MAX_FRAMES&&Array.isArray(data.resume.inputs)&&data.resume.inputs.length<=2500)battle.resume=data.resume;
    publish(battle);
  }
  async function complete(battle,player,body){
    if(ownerFor(battle,player.id)!==1)throw new HttpError(403,'Somente o atacante pode encerrar a simulação.');
    if(battle.final)return battle.final;
    const maxFrames=Math.min(MAX_FRAMES,Math.ceil(((now()-new Date(battle.startedAt).getTime())/1000+2)*30));
    let snapshot;try{snapshot=verifyBrowserBattle(engineFactory,battle.config,battle.inputs,body,maxFrames);}catch(error){throw new HttpError(409,error.message);}
    return finish(battle,snapshot.result,snapshot.reason||'elimination',snapshot.stats);
  }
  async function tick(){
    const jobs=[];
    for(const [id,battle]of battles){
      if(battle.final){if(now()-new Date(battle.startedAt).getTime()>900000)battles.delete(id);continue;}
      updateDefense(battle);
      if(now()-battle.lastHostAt>DISCONNECT_MS)jobs.push(finish(battle,'abandoned','disconnected'));
      else if(now()-new Date(battle.startedAt).getTime()>390000)jobs.push(finish(battle,'lost','time'));
    }
    await Promise.all(jobs);
  }
  const timer=startClock?setInterval(()=>tick().catch(()=>console.error('Não foi possível salvar o encerramento de uma batalha.')),1000):null;timer?.unref();
  async function body(req,max=8192){return new Promise((resolve,reject)=>{let text='',bytes=0,exceeded=false;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>max){exceeded=true;reject(new HttpError(413,'Solicitação muito grande.'));return;}text+=chunk;});req.on('error',()=>reject(new HttpError(400,'Solicitação incompleta.')));req.on('end',()=>{if(exceeded)return;try{const value=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();resolve(value);}catch{reject(new HttpError(400,'Solicitação inválida.'));}});});}
  function connectSocket(req,socket){
    if(new URL(req.url,'http://localhost').pathname!=='/api/world/socket')return false;
    socket.on('error',()=>{});let queued=0,chain=Promise.resolve();
    const authorized=(async()=>{
      if(!pool||closing)throw new HttpError(503,'O servidor está reiniciando.');
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host||req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Origem inválida.');
      const player=await playerFor(req);if(!player)throw new HttpError(401,'Entre na sua conta.');
      if(socket.readyState!==1)return null;
      if([...sockets].filter(s=>s.player.id===player.id).length>=5)throw new HttpError(429,'Muitas janelas abertas.');
      socket.player=player;socket.token=sessionToken(req);sockets.add(socket);socketEvent(socket,'ready',{});return player;
    })().catch(error=>{socketEvent(socket,'error',{message:error.status?error.message:'Conexão indisponível.'});socket.close(1008);return null;});
    socket.on('message',raw=>{
      if(++queued>64){socket.close(1008);return;}
      chain=chain.then(async()=>{
        let message;
        try{
          const player=await authorized;if(!player||socket.readyState!==1)return;
          if(!await playerFor(req)){socket.close(1008);return;}
          message=JSON.parse(String(raw));if(message.type==='ping'){socketEvent(socket,'pong',{});return;}
          const battle=battles.get(message.battleId);if(!battle||!ownerFor(battle,player.id))throw new HttpError(403,'Batalha indisponível para esta conta.');
          if(message.type==='relay'){relay(battle,player,message);return;}
          if(message.type!=='command'||!Number.isSafeInteger(message.requestId))throw new HttpError(400,'Comando inválido.');
          socketEvent(socket,'ack',{battleId:battle.id,requestId:message.requestId,...execute(battle,player,message.command)});
        }catch(error){socketEvent(socket,'ack',{battleId:message?.battleId,requestId:message?.requestId,accepted:false,message:error.status?error.message:'Não foi possível enviar a ordem.'});}
        finally{queued--;}
      }).catch(()=>{});
    });socket.on('close',()=>sockets.delete(socket));return true;
  }
  async function handle(req,res){
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(!pathname.startsWith('/api/world')&&!pathname.startsWith('/api/auth'))return false;
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try{
      if(!pool)throw new HttpError(503,'O mundo está indisponível.');
      const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];
      if(req.method==='POST'){
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new HttpError(415,'Envie uma solicitação JSON.');
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host||req.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'Origem inválida.');
      }
      const auth=pathname.match(/^\/api\/auth\/(register|login|logout)$/)?.[1];
      if(auth&&req.method==='POST'){
        rate('auth:'+ip,30,900000);const token=sessionToken(req),result=await authenticate(pool,req,res,auth,await body(req),!!process.env.RENDER||req.socket.encrypted);sessions.delete(token);
        for(const socket of sockets)if(socket.token===token)socket.close(1008);
        for(const battle of battles.values()){let released=false;for(const stream of battle.streams)if(stream.worldToken===token){battle.streams.delete(stream);stream.end();released=true;}if(released){battle.defenseUntil=0;updateDefense(battle);}}
        json(200,result);return true;
      }
      const player=await playerFor(req);
      if(pathname==='/api/world'&&req.method==='GET'){rate('world:'+ip,180,60000);json(200,await world(player));return true;}
      if(!player)throw new HttpError(401,'Entre na sua conta para disputar territórios.');
      const area=pathname.match(/^\/api\/world\/areas\/([a-z-]+)\/attack$/)?.[1];
      if(area&&req.method==='POST'){json(201,await start(player,area));return true;}
      const match=pathname.match(/^\/api\/world\/battles\/([^/]+)(?:\/(events|commands|surrender|defend|release|relay|complete))?$/);
      if(!match||!UUID.test(match[1]))throw new HttpError(404,'Rota não encontrada.');
      const [,id,action]=match,battle=await lookup(id,player.id),owner=ownerFor(battle,player.id);
      if(battle.final){json(200,{id,playerOwner:owner,status:battle.status,final:battle.final});return true;}
      if(!action&&req.method==='GET'){json(200,state(battle,owner,true));return true;}
      if(action==='events'&&req.method==='GET'){
        if([...battle.streams].filter(s=>s.worldOwner===owner).length>=3)throw new HttpError(429,'Muitas janelas desta batalha.');
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();res.worldOwner=owner;res.worldToken=sessionToken(req);battle.streams.add(res);
        updateDefense(battle);event(res,'state',state(battle,owner));if(owner===1)for(const input of battle.inputs.values())event(res,'input',input);
        res.on('close',()=>{battle.streams.delete(res);if(owner===2)battle.defenseUntil=0;updateDefense(battle);});return true;
      }
      if(action==='defend'&&req.method==='POST'){if(owner!==2)throw new HttpError(403,'Somente o proprietário pode assumir a defesa.');battle.defenseUntil=now()+5000;updateDefense(battle);json(200,state(battle,2));return true;}
      if(action==='release'&&req.method==='POST'){if(owner!==2)throw new HttpError(403,'Você não controla a defesa.');for(const stream of battle.streams)if(stream.worldOwner===2){battle.streams.delete(stream);stream.end();}battle.defenseUntil=0;updateDefense(battle);json(200,{released:true});return true;}
      if(action==='commands'&&req.method==='POST'){json(200,execute(battle,player,await body(req)));return true;}
      if(action==='relay'&&req.method==='POST'){relay(battle,player,await body(req,512*1024));json(200,{accepted:true});return true;}
      if(action==='complete'&&req.method==='POST'){json(200,await complete(battle,player,await body(req,512*1024)));return true;}
      if(action==='surrender'&&req.method==='POST'){if(owner!==1)throw new HttpError(403,'Devolva a defesa à CPU para sair.');json(200,await finish(battle,'abandoned','surrender'));return true;}
      throw new HttpError(404,'Rota não encontrada.');
    }catch(error){if(!error.status)console.error('Falha temporária na API do mundo.');json(error.status||503,{error:error.status?error.message:'O mundo está temporariamente indisponível.'});return true;}
  }
  async function close(){closing=true;if(timer)clearInterval(timer);for(const socket of sockets)socket.close(1012);await Promise.all([...battles.values()].filter(b=>!b.final).map(b=>finish(b,'interrupted','server_restart')));}
  return {handle,connectSocket,initialize,start,world,tick,close,battles};
}
module.exports={createWorldService,DISCONNECT_MS};
