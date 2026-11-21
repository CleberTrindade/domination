'use strict';
const {randomInt}=require('node:crypto');
const {readWallets}=require('./economy');
const {cardsNeeded}=require('./progression');
const rules=require('../shared/troop-rules');
const REWARD_RULES=Object.freeze({battleLimit:60,victory:10,defeat:5,missionReward:20,repeatLimit:3,minSeconds:30,timeZone:'America/Fortaleza',
 missions:Object.freeze([{id:'battles',label:'Concluir 3 batalhas válidas',target:3},{id:'captures',label:'Conquistar 5 bases inimigas',target:5},{id:'wins',label:'Vencer uma batalha',target:1}])});
function rewardDay(at){return new Date(at-3*3600000).toISOString().slice(0,10);}
function dailyView(row,at){
 const day=rewardDay(at),missions=row?.missions||[],battleCards=Number(row?.battle_cards||0);
 return {day,timeZone:REWARD_RULES.timeZone,resetsAt:new Date(Date.parse(day+'T03:00:00Z')+86400000).toISOString(),battleCards,battleLimit:60,
  missionCards:Number(row?.mission_cards||0),total:battleCards+Number(row?.mission_cards||0),limit:120,
  missions:REWARD_RULES.missions.map(m=>({...m,progress:Math.min(m.target,Number(row?.[m.id]||0)),reward:20,completed:missions.includes(m.id)}))};
}
function drawCards(wallet,count,random=randomInt){
 const balances={...wallet.cards},awarded={},commander=rules.commander(wallet.levels,wallet.battles).level;
 for(let i=0;i<count;i++){
  const eligible=rules.KINDS.filter(k=>rules.required(k)<=commander&&(balances[k]||0)<cardsNeeded(wallet.levels[k]||1));
  if(!eligible.length)break;
  const kind=eligible[random(eligible.length)];balances[kind]=(balances[kind]||0)+1;awarded[kind]=(awarded[kind]||0)+1;
 }
 return {balances,cards:awarded,total:Object.values(awarded).reduce((a,b)=>a+b,0)};
}
async function readDaily(db,playerId,at){
 const row=(await db.query('SELECT * FROM world_daily_rewards WHERE player_id=$1 AND reward_day=$2',[playerId,rewardDay(at)])).rows[0];
 const recent=(await db.query('SELECT cards,battle_cards,mission_cards,missions,created_at FROM world_card_rewards WHERE player_id=$1 AND battle_cards+mission_cards>0 ORDER BY created_at DESC,battle_id DESC LIMIT 5',[playerId])).rows;
 return {...dailyView(row,at),rules:REWARD_RULES,recent:recent.map(r=>({cards:r.cards,battleCards:r.battle_cards,missionCards:r.mission_cards,missions:r.missions,at:r.created_at}))};
}
// Called only after a server replay and while the participant wallets are locked
// by the result transaction. No database work is added to movement commands.
async function awardBattleCards(db,battle,roster,{status,winnerOwner,verified,at}){
 const wallets=await readWallets(db,roster.map(p=>p.playerId),at,true),results=[],day=rewardDay(at);
 for(const p of [...roster].sort((a,b)=>a.playerId.localeCompare(b.playerId))){
  const prior=(await db.query('SELECT cards,battle_cards,mission_cards,missions,reason FROM world_card_rewards WHERE battle_id=$1 AND player_id=$2',[battle.id,p.playerId])).rows[0];
  if(prior){results.push({playerId:p.playerId,...prior});continue;}
  const metrics=verified?.objectives?.[p.owner],active=(verified?.participation?.[p.owner]||0)>=30;
  let reason=!verified||!['won','lost'].includes(status)?'unverified':(verified.forfeited||[]).includes(p.owner)?'abandoned':!active?'inactive':!(metrics?.orders>0)?'no_orders':null;
  const opponents=roster.filter(x=>x.playerId!==p.playerId).map(x=>x.playerId).sort();
  const opponentKey=opponents.length?opponents.join(','):'cpu:'+battle.areaId;
  if(!reason){const repeats=(await db.query('SELECT count(*)::int AS n FROM world_card_rewards WHERE player_id=$1 AND reward_day=$2 AND opponent_key=$3 AND eligible',[p.playerId,day,opponentKey])).rows[0].n;if(repeats>=3)reason='repeated_opponent';}
  let cards={},battleCards=0,missionCards=0,completed=[];
  if(!reason){
   await db.query('INSERT INTO world_daily_rewards(player_id,reward_day) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.playerId,day]);
   const daily=(await db.query('SELECT * FROM world_daily_rewards WHERE player_id=$1 AND reward_day=$2 FOR UPDATE',[p.playerId,day])).rows[0];
   daily.battles++;daily.captures+=new Set(metrics.captured||[]).size;if(p.owner===winnerOwner)daily.wins++;
   completed=REWARD_RULES.missions.filter(m=>!daily.missions.includes(m.id)&&daily[m.id]>=m.target).map(m=>m.id);
   const requested=Math.min(60-daily.battle_cards,p.owner===winnerOwner?10:5),wallet=wallets.get(p.playerId);
   const draw=drawCards(wallet,requested+completed.length*20);cards=draw.cards;battleCards=Math.min(requested,draw.total);missionCards=draw.total-battleCards;
   // Objectives finish automatically. No eligible troop means no cards are
   // discarded into already-complete types or stored for a locked type.
   await db.query('UPDATE world_players SET troop_cards=$2::jsonb WHERE id=$1',[p.playerId,JSON.stringify(draw.balances)]);
   await db.query('UPDATE world_daily_rewards SET battle_cards=$3,battles=$4,captures=$5,wins=$6,missions=$7::jsonb,mission_cards=$8 WHERE player_id=$1 AND reward_day=$2',[p.playerId,day,daily.battle_cards+battleCards,daily.battles,daily.captures,daily.wins,JSON.stringify([...daily.missions,...completed]),daily.mission_cards+missionCards]);
   if(!draw.total)reason='all_cards_collected';
  }
  await db.query('INSERT INTO world_card_rewards(battle_id,player_id,reward_day,opponent_key,eligible,cards,battle_cards,mission_cards,missions,reason,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11)',[battle.id,p.playerId,day,opponentKey,!reason||reason==='all_cards_collected',JSON.stringify(cards),battleCards,missionCards,JSON.stringify(completed),reason,new Date(at).toISOString()]);
  results.push({playerId:p.playerId,cards,battleCards,missionCards,missions:completed,reason});
 }
 return results;
}
module.exports={REWARD_RULES,rewardDay,dailyView,drawCards,readDaily,awardBattleCards};
