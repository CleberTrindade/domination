'use strict';
const {randomUUID,randomInt}=require('node:crypto');
const engineFactory=require('./battle-engine');
const {verifyBrowserBattle,MAX_FRAMES}=require('../shared/browser-battle');
const {HttpError,getPlayer,authenticate,publicPlayer,sessionToken}=require('./auth');
const {RULES,productionFor,coins,stakeFor,readWallets,settleEconomy}=require('./economy');
const {ARMY_RULES,powerFor,areaProfile,armyView,troopView,TROOP_KINDS,combatProfile}=require('./progression');
const {playerProfile}=require('./player-profile');
const {troopCatalog}=require('./troops');
const troopRules=require('../shared/troop-rules');
const {MAX_FORMATIONS}=require('./formations');
const {awardBattleCards,readDaily,REWARD_RULES}=require('./card-rewards');
const {createDifficultySurveys,pendingDifficultySurveys,answerDifficultySurvey}=require('./difficulty-surveys');
const {friendList,searchPlayers,requestFriend,changeFriend,publicFriendProfile}=require('./friends');
const {historyPage,saveReplay,readReplay}=require('./battle-history');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const DISCONNECT_MS=30000;
function createWorldService(pool,{startClock=true,now=Date.now}={}){
  const battles=new Map(),sockets=new Set(),sessions=new Map(),limits=new Map();
  let closing=false,startQueue=Promise.resolve();
  function presence(id){const online=[...sockets].some(s=>s.player?.id===id&&s.readyState===1);return {online,inBattle:online&&[...battles.values()].some(b=>b.status==='active'&&participating(b,id))};}
  function rate(key,max,ms){const at=now();let entry=limits.get(key);if(!entry||entry.until<at){entry={n:0,until:at+ms};limits.set(key,entry);}if(limits.size>10000)limits.delete(limits.keys().next().value);if(++entry.n>max)throw new HttpError(429,'Muitas ordens. Aguarde um instante.');}
  async function playerFor(req){
    const token=sessionToken(req);if(!token)return null;
    const cached=sessions.get(token);if(cached&&cached.until>now())return cached.player;
    const player=await getPlayer(pool,req);if(player)sessions.set(token,{player,until:now()+60000});
    if(sessions.size>10000)sessions.delete(sessions.keys().next().value);return player;
  }
  function ownerFor(battle,id){
    const member=battle.members?.get(id),owner=battle.attackerId===id?1:battle.defenderId===id?2:member?.status==='active'?member.owner:0;
    return battle.withdrawn?.has(owner)?0:owner;
  }
  const participating=(battle,id)=>!!ownerFor(battle,id)&&(battle.attackerId===id||battle.members?.get(id)?.status==='active'||battle.defenderId===id&&battle.defenderControlled)||battle.members?.get(id)?.status==='pending';
  const playersFor=battle=>[{id:battle.attackerId,owner:1,name:battle.attackerName,...battle.armies?.[1]},{id:battle.defenderId,owner:2,name:battle.defenderName,...battle.armies?.[2],relativePower:battle.defenderId?null:battle.config.defenderPower/battle.config.attackerPower},...[...(battle.members?.values()||[])].filter(p=>p.owner>=3&&p.status!=='rejected').map(p=>({id:p.playerId,owner:p.owner,name:p.name,status:p.status,level:p.level,power:p.power,troops:p.troops,loadout:p.loadout}))];
  function reservedFor(playerId){
    let amount=0n;
    for(const battle of battles.values())if(!battle.final)for(const stake of battle.stakes?.values()||[])if(stake.playerId===playerId&&!stake.rejected)amount+=stake.stake;
    return amount;
  }
  async function reserveStake(battle,playerId,owner){
    const wallet=(await readWallets(pool,[playerId],now())).get(playerId);
    const balance=wallet.balance-reservedFor(playerId),available=balance>0n?balance:0n;
    const stake={playerId,owner,balance:available,stake:stakeFor(available),level:wallet.level,levels:wallet.levels,loadout:armyView(wallet,available,RULES.minEntry).loadout};
    battle.stakes.set(owner,stake);return stake;
  }
  function battleEconomy(battle,owner,viewerId){
    const stakes=[...(battle.stakes?.values()||[])].filter(s=>!s.rejected),mine=stakes.find(s=>s.owner===owner||s.playerId===viewerId);
    const maxLoot=mine?stakes.filter(s=>s.playerId!==mine.playerId).reduce((sum,s)=>sum+(s.stake<mine.stake?s.stake:mine.stake),0n):0n;
    return {lootPercent:RULES.lootPercent,minEntry:RULES.minEntry,wholeCoins:true,productionPerDay:RULES.productionPerDay,cpuReward:battle.cpuRewardAvailable&&mine?.balance>0n?(battle.cpuReward??RULES.cpuReward):0,
      atRisk:mine?coins(mine.stake):0,balanceAtEntry:mine?coins(mine.balance):null,maxLoot:coins(maxLoot),
      stakes:stakes.map(s=>({owner:s.owner,playerId:s.playerId,atRisk:coins(s.stake)}))};
  }
  function joinSites(battle){
    const reserved=new Set([...(battle.members?.values()||[])].filter(p=>p.status==='pending').map(p=>p.site));
    return battle.snapshot.sites.filter(site=>site.owner===0&&site.id!==0&&!reserved.has(site.id)).map(site=>({id:site.id,kind:engineFactory.maps.get(battle.config.mapId).data.seeds[site.id][1]}));
  }
  function state(battle,owner=1,full=false,viewerId=null){
    const member=battle.members?.get(viewerId),vacancy=![3,4].every(side=>[...(battle.members?.values()||[])].some(p=>p.owner===side&&p.status!=='rejected')),available=joinSites(battle);
    const record={id:battle.id,areaId:battle.areaId,areaName:battle.areaName,attackerName:battle.attackerName,defenderName:battle.defenderName,
      playerOwner:owner,defenderControlled:!!battle.defenderControlled,status:battle.status,startedAt:battle.startedAt,
      epoch:battle.id,revision:battle.revision,mode:'browser',config:battle.config,snapshot:battle.snapshot,retaliationOf:battle.retaliationOf||null,
      players:playersFor(battle),isHost:owner>0&&ownerFor(battle,battle.hostId)===owner,hostEpoch:battle.hostEpoch,maxOwners:4,
      joinableSites:available,canJoin:owner===0&&vacancy&&available.length>0&&!battle.snapshot.over&&!battle.finishing&&!['pending','active','left'].includes(member?.status),joinState:member?.status||null,joinError:member?.error||null,economy:battleEconomy(battle,owner,viewerId)};
    if(full&&record.isHost){record.resume=battle.resume;record.authorizedInputs=[...battle.inputs.values()];}
    return record;
  }
  function event(stream,type,data){if(!stream.destroyed&&!stream.writableEnded)stream.write('event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n');}
  function socketEvent(socket,type,data){if(socket.readyState!==1)return;if(socket.bufferedAmount>512*1024){socket.terminate();return;}socket.send(JSON.stringify({type,...data}));}
  function notify(type,data,playerId){for(const socket of sockets)if(!playerId||socket.player.id===playerId)socketEvent(socket,type,data);}
  function publish(battle){for(const stream of battle.streams){if(stream.writableLength>512*1024){stream.destroy();continue;}if(stream.worldPlayerId)stream.worldOwner=ownerFor(battle,stream.worldPlayerId);event(stream,'state',state(battle,stream.worldOwner,false,stream.worldPlayerId));}}
  function ticket(battle,input){
    if(battle.inputs.size>=2500)throw new HttpError(429,'Limite de ordens desta batalha atingido.');
    battle.inputs.set(input.nonce,input);
    for(const stream of battle.streams)if(stream.worldPlayerId===battle.hostId)event(stream,'input',input);
    notify('battle_input',{battleId:battle.id,input},battle.hostId);
  }
  function migrateHost(battle,excludedId=null){
    if(closing||battle.finishing)return false;
    const candidate=[...battle.streams].find(stream=>stream.worldPlayerId!==excludedId&&ownerFor(battle,stream.worldPlayerId)>0&&!stream.destroyed&&!stream.writableEnded);
    if(!candidate)return false;
    battle.hostId=candidate.worldPlayerId;battle.hostEpoch=randomUUID();battle.lastHostAt=now();battle.revision++;
    for(const stream of battle.streams){stream.worldOwner=ownerFor(battle,stream.worldPlayerId);event(stream,'host',state(battle,stream.worldOwner,true,stream.worldPlayerId));}
    for(const socket of sockets){const owner=ownerFor(battle,socket.player.id);if(owner>0)socketEvent(socket,'battle_host',{record:state(battle,owner,true,socket.player.id)});}
    return true;
  }
  async function joinBattle(battle,player,site){
    const task=startQueue.then(async()=>{
      if(battle.status!=='active'||battle.finishing||battle.snapshot.over)throw new HttpError(409,'A batalha já está sendo encerrada.');
      if(player.id===battle.attackerId||player.id===battle.defenderId)throw new HttpError(409,'Você já tem um lado nessa batalha.');
      const previous=battle.members.get(player.id);
      if(previous?.status==='pending')return state(battle,0,false,player.id);
      if(previous&&previous.status!=='rejected')throw new HttpError(409,'Você já participou desta batalha.');
      if([...battles.values()].some(other=>other.status==='active'&&participating(other,player.id)))throw new HttpError(409,'Você já está participando de uma batalha.');
      const owner=[3,4].find(side=>![...battle.members.values()].some(p=>p.owner===side&&p.status!=='rejected'));
      if(!owner)throw new HttpError(409,'Os quatro exércitos já estão ocupados. Você pode continuar assistindo.');
      if(!Number.isInteger(site)||!joinSites(battle).some(s=>s.id===site))throw new HttpError(409,'Esta base não está disponível. Escolha outra base neutra.');
      rate('join:'+player.id,8,60000);
      if(battle.inputs.size>=2500)throw new HttpError(429,'Limite de ordens desta batalha atingido.');
      const stake=await reserveStake(battle,player.id,owner);
      if(battle.status!=='active'||battle.finishing||battle.snapshot.over||battle.inputs.size>=2500){battle.stakes.delete(owner);throw new HttpError(409,'A batalha está sendo encerrada.');}
      const input={nonce:randomUUID(),kind:'join',owner,site,playerId:player.id,playerName:player.display_name,joinedAt:new Date(now()).toISOString(),armyLevel:stake.level,armyPower:powerFor(stake.level),armyTroops:combatProfile(stake.levels),armyLoadout:stake.loadout};
      battle.members.set(player.id,{playerId:player.id,name:player.display_name,owner,site,status:'pending',nonce:input.nonce,joinedAt:input.joinedAt,level:input.armyLevel,power:input.armyPower,troops:input.armyTroops,loadout:input.armyLoadout});
      ticket(battle,input);battle.revision++;publish(battle);notify('world_changed',{});
      return state(battle,0,false,player.id);
    });startQueue=task.catch(()=>{});return task;
  }
  async function leaveBattle(battle,player){
    const owner=ownerFor(battle,player.id);
    if(owner===2)throw new HttpError(403,'Devolva a defesa à CPU para sair.');
    if(!owner)return {watching:true};
    if(owner===1&&![...battle.members.values()].some(p=>p.status==='active'))return finish(battle,'abandoned','surrender');
    if(battle.snapshot.over||battle.finishing)throw new HttpError(409,'A batalha está sendo encerrada.');
    ticket(battle,{nonce:randomUUID(),kind:'leave',owner});battle.withdrawn.add(owner);
    const member=battle.members.get(player.id);if(member)member.status='left';
    if(battle.hostId===player.id&&!migrateHost(battle,player.id))return finish(battle,'abandoned','disconnected');
    battle.revision++;publish(battle);notify('world_changed',{});return {left:true};
  }
  function updateDefense(battle){
    if(battle.status!=='active')return;
    const controlled=now()<(battle.defenseUntil||0)||[...battle.streams].some(stream=>stream.worldOwner===2&&!stream.destroyed);
    if(controlled===!!battle.defenderControlled)return;
    if(controlled)battle.defenderEverControlled=true;
    battle.defenderControlled=controlled;battle.revision++;
    ticket(battle,{nonce:randomUUID(),kind:'control',controlled});publish(battle);notify('world_changed',{});
  }
  async function transaction(fn){const db=await pool.connect();try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}}
  async function upgradeArmy(player,input){
    if(!UUID.test(input.requestId)||!Number.isInteger(input.expectedLevel)||!TROOP_KINDS.includes(input.troopKind))throw new HttpError(400,'Solicitação de evolução inválida. Atualize seu exército.');
    rate('upgrade:'+player.id,15,60000);
    const task=startQueue.then(async()=>{
      if(closing)throw new HttpError(503,'O servidor está reiniciando.');
      const result=await transaction(async db=>{
        const at=now(),wallet=(await readWallets(db,[player.id],at,true)).get(player.id);
        const available=wallet.balance-reservedFor(player.id),view=troopView(wallet,available,RULES.minEntry,input.troopKind);
        const summary=(balance=wallet.balance,spendable=available)=>({balance:coins(balance),available:coins(spendable>0n?spendable:0n),reserved:coins(wallet.balance-available),productionPerDay:productionFor(wallet.owned)});
        const previous=(await db.query('SELECT player_id,to_level,cost,troop_kind,cards_spent FROM world_army_upgrades WHERE id=$1',[input.requestId])).rows[0];
        if(previous){if(previous.player_id!==player.id||previous.troop_kind!==input.troopKind)throw new HttpError(403,'Solicitação de evolução inválida.');return {alreadyApplied:true,requestId:input.requestId,level:previous.to_level,cost:coins(BigInt(previous.cost)),cardsSpent:previous.cards_spent,army:armyView(wallet,available,RULES.minEntry),wallet:summary()};}
        if(view.level!==input.expectedLevel)throw new HttpError(409,'Seu exército já mudou de nível. Atualize para continuar.');
        if(!view.canUpgrade)throw new HttpError(409,view.reason);
        const cost=BigInt(view.nextCost*100),date=new Date(at).toISOString();
        await db.query('INSERT INTO world_army_upgrades(id,player_id,from_level,to_level,cost,created_at,troop_kind,cards_spent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[input.requestId,player.id,view.level,view.nextLevel,cost.toString(),date,input.troopKind,view.nextCards]);
        const levels={...wallet.levels,[input.troopKind]:view.nextLevel},highest=Math.max(...Object.values(levels)),cards={...wallet.cards,[input.troopKind]:view.cards-view.nextCards};
        await db.query('UPDATE world_players SET army_level=$1,coin_balance=$2,coin_income_at=$3,coin_income_remainder=$4,troop_levels=$6::jsonb,troop_cards=$7::jsonb WHERE id=$5',[highest,(wallet.balance-cost).toString(),new Date(wallet.at).toISOString(),wallet.remainder.toString(),player.id,JSON.stringify(levels),JSON.stringify(cards)]);
        async function ledger(kind,amount){if(amount!==0n)await db.query('INSERT INTO world_coin_ledger(id,player_id,upgrade_id,kind,amount,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),player.id,input.requestId,kind,amount.toString(),date]);}
        await ledger('production',wallet.produced);await ledger('army_upgrade',-cost);
        return {requestId:input.requestId,level:view.nextLevel,cost:view.nextCost,cardsSpent:view.nextCards,army:armyView({...wallet,level:highest,levels,cards},available-cost,RULES.minEntry),wallet:summary(wallet.balance-cost,available-cost)};
      });notify('world_changed',{});return result;
    });startQueue=task.catch(()=>{});return task;
  }
  async function saveLoadout(player,input){
    if(!Array.isArray(input.troops)||input.troops.length<1||input.troops.length>3||new Set(input.troops).size!==input.troops.length)throw new HttpError(400,'Escolha de um a três tipos terrestres diferentes.');
    rate('loadout:'+player.id,20,60000);
    return transaction(async db=>{
      const wallet=(await readWallets(db,[player.id],now(),true)).get(player.id),available=wallet.balance-reservedFor(player.id),army=armyView(wallet,available,RULES.minEntry);
      if(input.troops.some(k=>!troopRules.GROUND.includes(k)||army.troops[k]?.locked))throw new HttpError(409,'Uma tropa ainda não foi desbloqueada. Confira seu comandante.');
      const formations=army.formations.map(f=>f.id===army.activeFormationId?{...f,troops:input.troops.slice()}:f),formationRevision=army.formationRevision+1;
      await db.query('UPDATE world_players SET ground_loadout=$2::jsonb,army_formations=$3::jsonb,formation_revision=$4 WHERE id=$1',[player.id,JSON.stringify(input.troops),JSON.stringify(formations),formationRevision]);
      return {army:armyView({...wallet,loadout:input.troops,formations,formationRevision},available,RULES.minEntry)};
    });
  }
  async function saveFormations(player,input){
    if(!input||typeof input!=='object')throw new HttpError(400,'Solicitação de formações inválida.');
    const validId=id=>typeof id==='string'&&(id==='initial'||UUID.test(id));
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!Array.isArray(input.formations)||!input.formations.length||input.formations.length>MAX_FORMATIONS||!validId(input.activeFormationId))throw new HttpError(400,'Solicitação de formações inválida.');
    const formations=input.formations.map(f=>{
      if(!f||!validId(f.id)||typeof f.name!=='string'||!f.name.trim()||f.name.trim().length>32||/[\u0000-\u001f\u007f]/.test(f.name)||!Array.isArray(f.troops)||!f.troops.length||f.troops.length>3||new Set(f.troops).size!==f.troops.length)throw new HttpError(400,'Cada formação precisa de nome e de um a três tipos terrestres diferentes.');
      return {id:f.id,name:f.name.trim(),troops:f.troops.slice()};
    });
    if(new Set(formations.map(f=>f.id)).size!==formations.length||!formations.some(f=>f.id===input.activeFormationId))throw new HttpError(400,'A formação ativa precisa fazer parte da sua lista.');
    rate('formations:'+player.id,30,60000);
    const result=await transaction(async db=>{
      const wallet=(await readWallets(db,[player.id],now(),true)).get(player.id),available=wallet.balance-reservedFor(player.id),army=armyView(wallet,available,RULES.minEntry);
      if(formations.some(f=>f.troops.some(k=>!troopRules.GROUND.includes(k)||army.troops[k]?.locked)))throw new HttpError(409,'Uma tropa ainda não foi desbloqueada. Confira seu comandante.');
      // A retry after a lost response is safe and never duplicates formations.
      if(JSON.stringify(formations)===JSON.stringify(army.formations)&&input.activeFormationId===army.activeFormationId)return {alreadyApplied:true,army};
      if(input.expectedRevision!==army.formationRevision)throw new HttpError(409,'Suas formações foram alteradas em outro dispositivo. Recarregue antes de salvar novamente.');
      const loadout=formations.find(f=>f.id===input.activeFormationId).troops,formationRevision=army.formationRevision+1;
      await db.query('UPDATE world_players SET army_formations=$2::jsonb,active_formation_id=$3,formation_revision=$4,ground_loadout=$5::jsonb WHERE id=$1',[player.id,JSON.stringify(formations),input.activeFormationId,formationRevision,JSON.stringify(loadout)]);
      return {army:armyView({...wallet,formations,activeFormationId:input.activeFormationId,formationRevision,loadout},available,RULES.minEntry)};
    });notify('world_changed',{},player.id);return result;
  }
  async function finish(battle,status,reason,stats={},verified=null,completion=null){
    if(battle.final)return battle.final;
    if(battle.finishing)return battle.finishing;
    battle.finishing=(async()=>{
      try{
        const final=await transaction(async db=>{
          const existing=(await db.query('SELECT status,result FROM world_battles WHERE id=$1 FOR UPDATE',[battle.id])).rows[0];
          if(existing&&existing.status!=='active')return existing.result||{status:existing.status};
          const area=(await db.query('SELECT version,owner_id,cpu_reward_claimed FROM world_areas WHERE id=$1 FOR UPDATE',[battle.areaId])).rows[0];
          const finalStatus=area?.version===battle.areaVersion?status:'expired';
          const roster=[{playerId:battle.attackerId,name:battle.attackerName,owner:1,joinedAt:battle.startedAt,...battle.armies?.[1]},...(battle.defenderId?[{playerId:battle.defenderId,name:battle.defenderName,owner:2,joinedAt:battle.startedAt,...battle.armies?.[2]}]:[]),...(verified?.validatedParticipants||[...battle.members.values()].filter(p=>p.status==='active'||p.status==='left'))];
          const winnerOwner=finalStatus==='won'?(verified?.winnerOwner||1):finalStatus==='lost'||finalStatus==='abandoned'?2:null;
          const winner=roster.find(p=>p.owner===winnerOwner);
          if(finalStatus==='won'&&!winner)throw new Error('Vencedor não registrado.');
          const result={status:finalStatus,reason,areaId:battle.areaId,areaName:battle.areaName,captures:stats.cap||0,kills:stats.kill||0,retaliationOf:battle.retaliationOf||null,winnerOwner,winnerId:winner?.playerId||null,winnerName:winner?.name||(winnerOwner===2?'Guarnição da CPU':null),
            balance:{version:battle.config.balanceVersion,config:battle.config,defenderShare:battle.defenseShare,defenderParticipated:!!battle.defenderEverControlled,armies:roster.map(p=>({owner:p.owner,level:p.level||1,power:p.power||1,troops:p.troops,loadout:p.loadout}))}};
          await db.query("INSERT INTO world_battles(id,area_id,attacker_id,defender_id,area_version,status,defense_share,started_at,finished_at,expires_at,result,retaliation_of,winner_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),$9::jsonb,$10,$11)",
            [battle.id,battle.areaId,battle.attackerId,battle.defenderId,battle.areaVersion,finalStatus,battle.defenseShare,battle.startedAt,JSON.stringify(result),battle.retaliationOf||null,winner?.playerId||null]);
          result.economy=await settleEconomy(db,battle,roster,{winnerOwner,status:finalStatus,area,at:now()});
          result.cardRewards=await awardBattleCards(db,battle,roster,{status:finalStatus,winnerOwner,verified,at:now()});
          if(finalStatus==='won')await db.query('UPDATE world_areas SET owner_id=$1,conquered_at=$4,version=version+1 WHERE id=$2 AND version=$3',[winner.playerId,battle.areaId,battle.areaVersion,new Date(now()).toISOString()]);
          await db.query('UPDATE world_battles SET result=$2::jsonb WHERE id=$1',[battle.id,JSON.stringify(result)]);
          for(const participant of roster)await db.query('INSERT INTO world_battle_participants(battle_id,player_id,side,joined_at,outcome,army_level) VALUES($1,$2,$3,$4,$5,$6)',[battle.id,participant.playerId,participant.owner,participant.joinedAt,participant.owner===winnerOwner?'won':(verified?.forfeited||[...battle.withdrawn]).includes(participant.owner)?'left':'lost',participant.level||1]);
          await createDifficultySurveys(db,battle,roster,{status:finalStatus,winnerOwner,at:now()});
          if(['won','lost'].includes(finalStatus))await saveReplay(db,battle,completion);
          if(verified&&verified.time>=30&&['won','lost'].includes(finalStatus)){
            const eligible=roster.filter(p=>!(verified.forfeited||[]).includes(p.owner)&&(battle.config.balanceVersion==='troops-v3'?(verified.participation?.[p.owner]||0)>=30:(p.owner!==2||battle.defenderEverControlled)));
            if(eligible.length)await db.query('UPDATE world_players SET battles_completed=battles_completed+1 WHERE id=ANY($1::uuid[])',[eligible.map(p=>p.playerId)]);
          }
          return result;
        });
        battle.status=final.status;battle.final=final;
        for(const stream of battle.streams){event(stream,'result',final);stream.end();}battle.streams.clear();
        battle.inputs.clear();battle.resume=null;notify('world_changed',{});return final;
      }catch(error){for(const stream of battle.streams)event(stream,'saving',{message:'Salvando o resultado…'});throw error;}
      finally{battle.finishing=null;}
    })();return battle.finishing;
  }
  async function lookup(id,playerId,watch=false){
    let battle=battles.get(id);if(battle){if(!watch&&!ownerFor(battle,playerId))throw new HttpError(403,'Essa batalha pertence a outro comandante.');return battle;}
    const row=(await pool.query('SELECT * FROM world_battles WHERE id=$1',[id])).rows[0];
    if(!row)throw new HttpError(404,'A batalha não está mais disponível. Volte ao mapa para iniciar outra.');
    const members=(await pool.query('SELECT player_id,side,outcome FROM world_battle_participants WHERE battle_id=$1',[id])).rows;
    battle={id,areaId:row.area_id,attackerId:row.attacker_id,defenderId:row.defender_id,status:row.status,final:row.result,members:new Map(members.map(p=>[p.player_id,{playerId:p.player_id,owner:p.side,status:p.outcome==='left'?'left':'active'}]))};
    if(!watch&&!ownerFor(battle,playerId))throw new HttpError(403,'Essa batalha pertence a outro comandante.');
    return battle;
  }
  async function initialize(){
    if(!pool)return;
    // Legacy server-simulated matches cannot be resumed with a browser input log.
    await pool.query("UPDATE world_battles SET status='interrupted',finished_at=now(),simulation=NULL,result=jsonb_build_object('status','interrupted','reason','server_restart','areaId',area_id) WHERE status='active'");
  }
  async function start(player,areaId,retaliationOf=null){
    if(closing)throw new HttpError(503,'O servidor está reiniciando.');rate('start:'+player.id,8,60000);
    const task=startQueue.then(async()=>{
      for(const battle of battles.values())if(battle.status==='active'){
        if(participating(battle,player.id))throw new HttpError(409,'Você já tem uma batalha em andamento.');
        if(battle.areaId===areaId)throw new HttpError(409,'Essa área está em disputa.');
      }
      const area=(await pool.query('SELECT a.*,p.display_name AS owner_name FROM world_areas a LEFT JOIN world_players p ON p.id=a.owner_id WHERE a.id=$1',[areaId])).rows[0];
      if(!area)throw new HttpError(404,'Área não encontrada.');if(area.owner_id===player.id)throw new HttpError(409,'Essa área já pertence a você.');
      if(retaliationOf){
        const original=await lookup(retaliationOf,player.id);
        if(original.defenderId!==player.id)throw new HttpError(403,'Somente quem sofreu o ataque pode responder.');
        if(original.status==='active')throw new HttpError(409,'A batalha ainda está em andamento. Assuma a defesa.');
        const opponents=new Set([original.attackerId,...[...(original.members?.values()||[])].filter(p=>p.owner>=3).map(p=>p.playerId)]);
        if(!opponents.has(area.owner_id))throw new HttpError(409,'Essa área não pertence mais ao agressor. Atualize a lista de ataques.');
      }
      const config={share:.50,difficulty:area.ordinal,seed:randomInt(1,2147483647),centralOwner:2,defenderBaseCount:ARMY_RULES.defenderBaseCount,balanceVersion:ARMY_RULES.balanceVersion,mapId:engineFactory.maps.forArea(area.id)};
      const battle={id:randomUUID(),areaId:area.id,areaName:area.name,areaVersion:area.version,attackerId:player.id,attackerName:player.display_name,
        defenderId:area.owner_id,defenderName:area.owner_name||'Guarnição da CPU',config,
        status:'active',startedAt:new Date(now()).toISOString(),lastClientAt:now(),lastHostAt:now(),revision:0,streams:new Set(),inputs:new Map(),resume:null,retaliationOf,members:new Map(),withdrawn:new Set(),hostId:player.id,hostEpoch:randomUUID(),stakes:new Map(),cpuRewardAvailable:!area.owner_id&&!area.cpu_reward_claimed,cpuReward:areaProfile(area.ordinal).cpuReward};
      const attacker=await reserveStake(battle,player.id,1),defender=area.owner_id?await reserveStake(battle,area.owner_id,2):null;
      Object.assign(config,{attackerLevel:attacker.level,attackerPower:powerFor(attacker.level),defenderLevel:defender?.level??null,
        defenderPower:defender?powerFor(defender.level):powerFor(attacker.level)*ARMY_RULES.cpuPowerRatio,neutralPower:powerFor(attacker.level),attackerTroops:combatProfile(attacker.levels),defenderTroops:defender?combatProfile(defender.levels):combatProfile(attacker.levels,ARMY_RULES.cpuPowerRatio,true),neutralTroops:combatProfile(attacker.levels),attackerLoadout:attacker.loadout,defenderLoadout:defender?.loadout||attacker.loadout});
      const initial=engineFactory.createBattle(config).snapshot();battle.snapshot=initial;battle.defenseShare=initial.defenderShare;battle.armies=initial.armies;
      if(closing)throw new HttpError(503,'O servidor está reiniciando.');
      battles.set(battle.id,battle);notify('world_changed',{});
      notify('area_under_attack',{battleId:battle.id,areaId:battle.areaId,areaName:battle.areaName,attackerId:battle.attackerId,defenderId:battle.defenderId});
      if(battle.defenderId)notify('under_attack',{battleId:battle.id,areaId:battle.areaId,areaName:battle.areaName,attackerName:battle.attackerName},battle.defenderId);
      return state(battle,1,true);
    });startQueue=task.catch(()=>{});return task;
  }
  async function world(player){
    const areas=(await pool.query('SELECT a.*,p.display_name AS owner_name,p.army_level AS owner_level FROM world_areas a LEFT JOIN world_players p ON p.id=a.owner_id ORDER BY a.ordinal')).rows;
    for(const area of areas){const battle=[...battles.values()].find(b=>b.areaId===area.id&&b.status==='active'),profile=areaProfile(area.ordinal),map=engineFactory.maps.get(engineFactory.maps.forArea(area.id)),setup=engineFactory.initialSites(.5,area.ordinal,2,ARMY_RULES.defenderBaseCount,map.id);Object.assign(area,{map_id:map.id,map_name:map.name,map_tag:map.tag,map_description:map.description,map_defender_sites:setup.sites.filter(s=>s.owner===2).map(s=>s.id),map_attacker_site:setup.sites.find(s=>s.owner===1).id,battle_id:battle?.id||null,attacker_id:battle?.attackerId||null,attacker_name:battle?.attackerName||null,defender_controlled:!!battle?.defenderControlled,participant_ids:battle?[...battle.members.values()].filter(p=>p.status==='active'||p.status==='pending').map(p=>p.playerId):[],defense_share:setup.defenderShare,defense_bases:ARMY_RULES.defenderBaseCount,resistance:profile.resistance,first_capture_reward:profile.cpuReward});}
    const ranking=(await pool.query('SELECT p.id,p.display_name AS name,count(*)::int AS areas FROM world_players p JOIN world_areas a ON a.owner_id=p.id GROUP BY p.id,p.display_name ORDER BY areas DESC,p.display_name LIMIT 10')).rows;
    const history=(await pool.query("SELECT b.id,b.status,b.finished_at,a.name AS area_name,p.display_name AS attacker_name,d.display_name AS defender_name,w.display_name AS winner_name FROM world_battles b JOIN world_areas a ON a.id=b.area_id JOIN world_players p ON p.id=b.attacker_id LEFT JOIN world_players d ON d.id=b.defender_id LEFT JOIN world_players w ON w.id=b.winner_id WHERE b.status<>'active' ORDER BY b.finished_at DESC LIMIT 12")).rows;
    const wallets=player?await readWallets(pool,[player.id,...areas.map(a=>a.owner_id)],now()):new Map(),ownWallet=wallets.get(player?.id);
    let wallet=null,army=null;
    if(ownWallet){
      const reserved=reservedFor(player.id),available=ownWallet.balance>reserved?ownWallet.balance-reserved:0n;
      const entries=(await pool.query('SELECT l.kind,l.amount,l.created_at,a.name AS area_name,u.to_level AS upgrade_level,u.troop_kind FROM world_coin_ledger l LEFT JOIN world_battles b ON b.id=l.battle_id LEFT JOIN world_areas a ON a.id=b.area_id LEFT JOIN world_army_upgrades u ON u.id=l.upgrade_id WHERE l.player_id=$1 ORDER BY l.created_at DESC,l.id DESC LIMIT 15',[player.id])).rows;
      army=armyView(ownWallet,available,RULES.minEntry);
      wallet={balance:coins(ownWallet.balance),available:coins(available),reserved:coins(reserved),productionPerDay:productionFor(ownWallet.owned),
        entries:entries.map(e=>({...e,amount:coins(BigInt(e.amount))}))};
      for(const area of areas){const defenseWallet=wallets.get(area.owner_id),defenseAvailable=defenseWallet?defenseWallet.balance-reservedFor(area.owner_id):0n;
        const risk=stakeFor(available),targetRisk=stakeFor(defenseAvailable>0n?defenseAvailable:0n);
        area.economy={atRisk:coins(risk),maxLoot:coins(targetRisk<risk?targetRisk:risk),cpuReward:available>0n&&!area.owner_id&&!area.cpu_reward_claimed?area.first_capture_reward:0,productionPerDay:area.owner_id===player.id?0:productionFor(ownWallet.owned+1)-productionFor(ownWallet.owned)};
        const active=area.battle_id&&battles.get(area.battle_id);
        if(active){
          const current=battleEconomy(active,ownerFor(active,player.id),player.id);
          if(current.balanceAtEntry!==null)area.economy={...area.economy,atRisk:current.atRisk,maxLoot:current.maxLoot,cpuReward:current.cpuReward};
          else area.economy.maxLoot=current.stakes.reduce((sum,s)=>sum+Math.min(coins(risk),s.atRisk),0);
        }
      }
    }
    let receivedAttacks=[];
    if(player){
      receivedAttacks=(await pool.query("SELECT b.id,b.area_id,a.name AS area_name,b.attacker_id,p.display_name AS attacker_name,b.status,b.started_at,b.finished_at FROM world_battles b JOIN world_areas a ON a.id=b.area_id JOIN world_players p ON p.id=b.attacker_id WHERE b.defender_id=$1 AND b.status<>'active' ORDER BY b.started_at DESC,b.id DESC LIMIT 20",[player.id])).rows;
      for(const battle of battles.values())if(battle.status==='active'&&battle.defenderId===player.id)receivedAttacks.push({id:battle.id,area_id:battle.areaId,area_name:battle.areaName,attacker_id:battle.attackerId,attacker_name:battle.attackerName,status:'active',started_at:battle.startedAt,finished_at:null});
      receivedAttacks.sort((a,b)=>new Date(b.started_at)-new Date(a.started_at)||b.id.localeCompare(a.id));receivedAttacks=receivedAttacks.slice(0,20);
      const extraParticipants=receivedAttacks.length?(await pool.query('SELECT battle_id,player_id FROM world_battle_participants WHERE battle_id=ANY($1::uuid[]) AND side>=3',[receivedAttacks.map(attack=>attack.id)])).rows:[];
      for(const attack of receivedAttacks){
        const original=areas.find(a=>a.id===attack.area_id);
        const opponents=new Set([attack.attacker_id,...extraParticipants.filter(p=>p.battle_id===attack.id).map(p=>p.player_id)]);
        attack.canDefend=attack.status==='active'&&original?.owner_id===player.id&&original.battle_id===attack.id;
        attack.revengeArea=attack.status!=='active'&&opponents.has(original?.owner_id)?{id:original.id,name:original.name,ownerName:original.owner_name,busy:!!original.battle_id}:null;
        attack.counterAreas=attack.status==='active'?[]:areas.filter(a=>opponents.has(a.owner_id)&&a.id!==attack.revengeArea?.id).map(a=>({id:a.id,name:a.name,ownerName:a.owner_name,busy:!!a.battle_id}));
      }
    }
    const dailyRewards=player?await readDaily(pool,player.id,now()):null;
    const difficultySurveys=await pendingDifficultySurveys(pool,player?.id);
    return {player:publicPlayer(player),wallet,army,dailyRewards,difficultySurveys,rewardRules:REWARD_RULES,troops:troopCatalog(army),progression:ARMY_RULES,economy:RULES,country:'Brasil',region:'Nordeste',state:'Sergipe',stateId:'SE',areas,ranking,history,receivedAttacks,activeBattle:[...battles.values()].find(b=>b.status==='active'&&player&&participating(b,player.id))?.id||null};
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
    if(battle.hostId!==player.id)throw new HttpError(403,'Somente o navegador responsável pode transmitir a simulação.');
    if(data.hostEpoch&&data.hostEpoch!==battle.hostEpoch)throw new HttpError(409,'A simulação foi transferida para outra janela.');
    if(battle.status!=='active'||battle.finishing)return;
    rate('relay:'+player.id,40,1000);
    const snapshot=data.snapshot;
    if(!snapshot||!Number.isFinite(snapshot.time)||snapshot.time<0||snapshot.time>361||snapshot.sites?.length!==17||!Array.isArray(snapshot.units)||snapshot.units.length>512)throw new HttpError(400,'Estado inválido.');
    battle.snapshot=snapshot;battle.lastHostAt=now();battle.lastClientAt=now();battle.revision++;
    if(data.resume&&Number.isInteger(data.resume.frames)&&data.resume.frames>=0&&data.resume.frames<=MAX_FRAMES&&Array.isArray(data.resume.inputs)&&data.resume.inputs.length<=2500)battle.resume=data.resume;
    for(const receipt of (Array.isArray(data.receipts)?data.receipts:[]).slice(0,64)){
      const input=battle.inputs.get(receipt.nonce);if(!input||input.kind!=='join')continue;
      const member=battle.members.get(input.playerId);if(!member||member.nonce!==input.nonce||member.status!=='pending')continue;
      if(receipt.accepted===true){input.confirmedAccepted=true;member.status='active';member.error=null;}
      else if(receipt.accepted===false){input.confirmedAccepted=false;battle.stakes.get(member.owner).rejected=true;member.status='rejected';member.owner=0;member.error='Esta base foi ocupada antes da sua entrada. Escolha outra base neutra.';}
      notify('world_changed',{});
    }
    publish(battle);
  }
  async function complete(battle,player,body){
    if(battle.hostId!==player.id)throw new HttpError(403,'Somente o navegador responsável pode encerrar a simulação.');
    if(body.hostEpoch&&body.hostEpoch!==battle.hostEpoch)throw new HttpError(409,'A simulação foi transferida para outra janela.');
    if(battle.final)return battle.final;
    const maxFrames=Math.min(MAX_FRAMES,Math.ceil(((now()-new Date(battle.startedAt).getTime())/1000+2)*30));
    let snapshot;try{snapshot=verifyBrowserBattle(engineFactory,battle.config,battle.inputs,body,maxFrames);}catch(error){throw new HttpError(409,error.message);}
    return finish(battle,snapshot.result,snapshot.reason||'elimination',snapshot.stats,snapshot,{frames:body.frames,inputs:body.inputs});
  }
  async function tick(){
    const jobs=[];
    for(const [id,battle]of battles){
      if(battle.final){if(now()-new Date(battle.startedAt).getTime()>900000)battles.delete(id);continue;}
      updateDefense(battle);
      if(now()-battle.lastHostAt>3000&&migrateHost(battle,battle.hostId))continue;
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
      socket.player=player;socket.token=sessionToken(req);sockets.add(socket);socketEvent(socket,'ready',{});notify('friends_changed',{});return player;
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
    });socket.on('close',()=>{sockets.delete(socket);notify('friends_changed',{});});return true;
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
      if(pathname==='/api/world/history'&&req.method==='GET'){
        rate('history:'+ip,60,60000);const q=new URL(req.url,'http://localhost').searchParams,scope=q.get('scope')||'world',page=q.get('page')||'1';
        if(!['mine','world'].includes(scope)||!/^\d{1,6}$/.test(page)||+page<1)throw new HttpError(400,'Página de histórico inválida.');
        json(200,await historyPage(pool,player,{scope,page:+page}));return true;
      }
      if(!player)throw new HttpError(401,'Entre na sua conta para disputar territórios.');
      if(pathname==='/api/world/friends'&&req.method==='GET'){
        rate('friends:'+player.id,90,60000);const q=new URL(req.url,'http://localhost').searchParams,page=q.get('page')||'1';if(!/^[1-9]\d{0,5}$/.test(page))throw new HttpError(400,'Página inválida.');json(200,await friendList(pool,player.id,presence,+page));return true;
      }
      if(pathname==='/api/world/friends/search'&&req.method==='GET'){rate('friend-search:'+player.id,45,60000);json(200,{players:await searchPlayers(pool,player.id,new URL(req.url,'http://localhost').searchParams.get('q'))});return true;}
      if(pathname==='/api/world/friends/request'&&req.method==='POST'){
        rate('friend-request:'+player.id,20,60000);const input=await body(req),result=await transaction(db=>requestFriend(db,player.id,input.playerId));notify('friends_changed',{},player.id);notify('friends_changed',{},input.playerId);json(200,result);return true;
      }
      const friendship=pathname.match(/^\/api\/world\/friends\/([a-f0-9-]+)\/(accept|reject|cancel|remove)$/);
      if(friendship&&req.method==='POST'){rate('friend-change:'+player.id,30,60000);const result=await transaction(db=>changeFriend(db,player.id,friendship[1],friendship[2]));notify('friends_changed',{},player.id);notify('friends_changed',{},result.otherId);json(200,{saved:true});return true;}
      const friendProfile=pathname.match(/^\/api\/world\/friends\/players\/([a-f0-9-]+)$/)?.[1];
      if(friendProfile&&UUID.test(friendProfile)&&req.method==='GET'){rate('friend-profile:'+player.id,45,60000);json(200,await publicFriendProfile(pool,friendProfile,presence));return true;}
      const replayId=pathname.match(/^\/api\/world\/replays\/([a-f0-9-]+)$/)?.[1];
      if(replayId&&UUID.test(replayId)&&req.method==='GET'){rate('replay:'+player.id,20,60000);json(200,await readReplay(pool,replayId));return true;}
      const surveyId=pathname.match(/^\/api\/world\/difficulty-surveys\/([^/]+)$/)?.[1];
      if(surveyId&&UUID.test(surveyId)&&req.method==='POST'){
        rate('difficulty:'+player.id,30,60000);const input=await body(req);
        const result=await transaction(db=>answerDifficultySurvey(db,player.id,surveyId,input.rating,now()));
        notify('world_changed',{},player.id);json(200,result);return true;
      }
      if(pathname==='/api/world/profile'&&req.method==='GET'){
        rate('profile:'+player.id,60,60000);
        const page=new URL(req.url,'http://localhost').searchParams.get('page')||'1';
        if(!/^[1-9]\d{0,5}$/.test(page))throw new HttpError(400,'Página de histórico inválida.');
        json(200,await playerProfile(pool,player,Number(page)));return true;
      }
      if(pathname==='/api/world/army/formations'&&req.method==='POST'){json(200,await saveFormations(player,await body(req)));return true;}
      if(pathname==='/api/world/army/loadout'&&req.method==='POST'){json(200,await saveLoadout(player,await body(req)));return true;}
      if(pathname==='/api/world/army/upgrade'&&req.method==='POST'){json(200,await upgradeArmy(player,await body(req)));return true;}
      const area=pathname.match(/^\/api\/world\/areas\/([a-z-]+)\/attack$/)?.[1];
      if(area&&req.method==='POST'){json(201,await start(player,area));return true;}
      const match=pathname.match(/^\/api\/world\/battles\/([^/]+)(?:\/(events|commands|surrender|defend|release|relay|complete|retaliate|join|leave))?$/);
      if(!match||!UUID.test(match[1]))throw new HttpError(404,'Rota não encontrada.');
      const [,id,action]=match,battle=await lookup(id,player.id,req.method==='GET'&&(!action||action==='events')||req.method==='POST'&&action==='join'),owner=ownerFor(battle,player.id);
      if(action==='retaliate'&&req.method==='POST'){
        if(owner!==2)throw new HttpError(403,'Somente quem sofreu o ataque pode responder.');
        const input=await body(req);
        if(typeof input.areaId!=='string'||!/^se-[a-z-]+$/.test(input.areaId))throw new HttpError(400,'Escolha a área para responder ao ataque.');
        json(201,await start(player,input.areaId,id));return true;
      }
      if(battle.final){json(200,{id,playerOwner:owner,status:battle.status,final:battle.final});return true;}
      if(!action&&req.method==='GET'){json(200,state(battle,owner,true,player.id));return true;}
      if(action==='join'&&req.method==='POST'){const input=await body(req);json(200,await joinBattle(battle,player,input.site));return true;}
      if(action==='leave'&&req.method==='POST'){json(200,await leaveBattle(battle,player));return true;}
      if(action==='events'&&req.method==='GET'){
        if([...battle.streams].filter(s=>s.worldPlayerId===player.id).length>=3||owner===0&&[...battle.streams].filter(s=>s.worldOwner===0).length>=60)throw new HttpError(429,'Muitas janelas desta batalha.');
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();res.worldOwner=owner;res.worldPlayerId=player.id;res.worldToken=sessionToken(req);battle.streams.add(res);
        updateDefense(battle);event(res,'state',state(battle,owner,false,player.id));if(battle.hostId===player.id)for(const input of battle.inputs.values())event(res,'input',input);
        res.on('close',()=>{battle.streams.delete(res);if(owner===2)battle.defenseUntil=0;updateDefense(battle);});return true;
      }
      if(action==='defend'&&req.method==='POST'){if(owner!==2)throw new HttpError(403,'Somente o proprietário pode assumir a defesa.');battle.defenseUntil=now()+5000;updateDefense(battle);json(200,state(battle,2));return true;}
      if(action==='release'&&req.method==='POST'){if(owner!==2)throw new HttpError(403,'Você não controla a defesa.');for(const stream of battle.streams)if(stream.worldOwner===2){battle.streams.delete(stream);stream.end();}battle.defenseUntil=0;updateDefense(battle);json(200,{released:true});return true;}
      if(action==='commands'&&req.method==='POST'){json(200,execute(battle,player,await body(req)));return true;}
      if(action==='relay'&&req.method==='POST'){relay(battle,player,await body(req,512*1024));json(200,{accepted:true});return true;}
      if(action==='complete'&&req.method==='POST'){json(200,await complete(battle,player,await body(req,512*1024)));return true;}
      if(action==='surrender'&&req.method==='POST'){if(!owner||owner===2)throw new HttpError(403,'Devolva a defesa à CPU para sair.');json(200,await leaveBattle(battle,player));return true;}
      throw new HttpError(404,'Rota não encontrada.');
    }catch(error){if(!error.status)console.error('Falha temporária na API do mundo.');json(error.status||503,{error:error.status?error.message:'O mundo está temporariamente indisponível.'});return true;}
  }
  async function close(){closing=true;if(timer)clearInterval(timer);for(const socket of sockets)socket.close(1012);await Promise.all([...battles.values()].filter(b=>!b.final).map(b=>finish(b,'interrupted','server_restart')));}
  return {handle,connectSocket,initialize,start,world,tick,close,battles};
}
module.exports={createWorldService,DISCONNECT_MS};
