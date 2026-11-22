'use strict';
const {HttpError}=require('./auth');
const REPLAY_VERSION='troops-v3-replay-v1';
async function historyPage(db,player,{scope='world',page=1}={}){
 if(scope==='mine'&&!player)throw new HttpError(401,'Entre para ver suas partidas.');
 const viewer=player?.id||null,filter=scope==='mine'?`AND (b.attacker_id=$1 OR b.defender_id=$1 OR EXISTS(SELECT 1 FROM world_battle_participants p WHERE p.battle_id=b.id AND p.player_id=$1))`:'AND ($1::uuid IS NULL OR true)';
 const count=(await db.query(`SELECT count(*)::int AS n FROM world_battles b WHERE b.status<>'active' ${filter}`,[viewer])).rows[0].n;
 const size=10,pages=Math.max(1,Math.ceil(count/size)),current=Math.min(page,pages);
 const rows=(await db.query(`SELECT b.id,b.area_id,a.name AS area_name,b.attacker_id,b.defender_id,b.status,b.winner_id,b.started_at,b.finished_at,b.result,
 attacker.display_name AS attacker_name,defender.display_name AS defender_name,
 EXISTS(SELECT 1 FROM world_battle_replays r WHERE r.battle_id=b.id AND r.engine_version=$4) AS can_replay,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('playerId',p.player_id,'name',u.display_name,'owner',p.side,'outcome',p.outcome,'level',p.army_level) ORDER BY p.side) FROM world_battle_participants p JOIN world_players u ON u.id=p.player_id WHERE p.battle_id=b.id),'[]'::jsonb) AS roster
 FROM world_battles b JOIN world_areas a ON a.id=b.area_id JOIN world_players attacker ON attacker.id=b.attacker_id LEFT JOIN world_players defender ON defender.id=b.defender_id
 WHERE b.status<>'active' ${filter} ORDER BY b.finished_at DESC,b.id DESC LIMIT $2 OFFSET $3`,[viewer,size,(current-1)*size,REPLAY_VERSION])).rows;
 return {scope,pagination:{page:current,pages,total:count,pageSize:size},matches:rows.map(row=>{
  const result=row.result||{},config=result.balance?.config||{},profiles=result.balance?.armies||[];
  let roster=row.roster||[];
  if(!roster.some(p=>p.owner===1))roster.push({playerId:row.attacker_id,name:row.attacker_name,owner:1});
  if(!roster.some(p=>p.owner===2))roster.push({playerId:row.defender_id,name:row.defender_name||'Guarnição da CPU',owner:2});
  roster=roster.sort((a,b)=>a.owner-b.owner).map(p=>{
   const frozen=profiles.find(a=>a.owner===p.owner),troops=frozen?.troops||(p.owner===1?config.attackerTroops:p.owner===2?config.defenderTroops:null)||null;
   const loadout=frozen?.loadout||(p.owner===1?config.attackerLoadout:p.owner===2?config.defenderLoadout:null)||[];
   return {...p,troops,loadout:loadout.slice(0,3),automaticDefense:p.owner===2&&!!p.playerId&&result.balance?.defenderParticipated===false};
  });
  const mine=roster.find(p=>p.playerId===viewer),cancelled=['expired','interrupted'].includes(row.status),winner=result.winnerOwner??(row.status==='won'?1:['lost','abandoned'].includes(row.status)?2:null);
  const perspective=mine?.owner||1,amount=result.economy?.participants?.find(p=>p.playerId===(viewer||row.attacker_id))?.change;
  const card=result.cardRewards?.find(p=>p.playerId===(viewer||row.attacker_id));
  return {id:row.id,areaId:row.area_id,areaName:row.area_name,context:row.defender_id?'occupied':'cpu',status:row.status,outcome:cancelled?'cancelled':mine?.outcome==='left'?'left':winner===perspective?'won':'lost',perspective,winnerOwner:winner,startedAt:row.started_at,finishedAt:row.finished_at,duration:Math.max(0,Math.round((new Date(row.finished_at)-new Date(row.started_at))/1000)),coinChange:amount??null,cards:card?(card.battleCards||0)+(card.missionCards||0):null,roster,canReplay:row.can_replay};
 })};
}
async function saveReplay(db,battle,completion){
 if(!completion)return;
 const inputs=completion.inputs.map(a=>({frame:a.frame,accepted:a.accepted,input:battle.inputs.get(a.nonce)}));
 await db.query('INSERT INTO world_battle_replays(battle_id,engine_version,config,frames,inputs) VALUES($1,$2,$3::jsonb,$4,$5::jsonb) ON CONFLICT(battle_id) DO NOTHING',[battle.id,REPLAY_VERSION,JSON.stringify(battle.config),completion.frames,JSON.stringify(inputs)]);
}
async function readReplay(db,id){
 const row=(await db.query('SELECT r.*,a.ordinal,a.name AS area_name FROM world_battle_replays r JOIN world_battles b ON b.id=r.battle_id JOIN world_areas a ON a.id=b.area_id WHERE r.battle_id=$1',[id])).rows[0];
 if(!row||row.engine_version!==REPLAY_VERSION)throw new HttpError(404,'Esta partida não possui replay compatível.');
 return {id:row.battle_id,config:row.config,frames:row.frames,inputs:row.inputs,ordinal:row.ordinal,areaName:row.area_name};
}
module.exports={historyPage,saveReplay,readReplay,REPLAY_VERSION};
