'use strict';
const {randomUUID}=require('node:crypto');
const RULES=Object.freeze({initialCoins:1000,minEntry:100,productionPerDay:1000,cpuReward:300,lootPercent:40});
const DAY=86400000n,CENTS=100n;
const coins=value=>Number(value)/100;
const stakeFor=balance=>balance*BigInt(RULES.lootPercent)/100n;
function projectWallet(row,at){
  const since=new Date(row.coin_income_at).getTime(),until=Math.max(since,at);
  const numerator=BigInt(Math.floor(until-since))*BigInt(row.owned||0)*BigInt(RULES.productionPerDay)*CENTS+BigInt(row.coin_income_remainder);
  const produced=numerator/DAY;
  return {playerId:row.id,balance:BigInt(row.coin_balance)+produced,produced,remainder:numerator%DAY,at:until,owned:Number(row.owned||0),level:Number(row.army_level||1)};
}
async function readWallets(db,ids,at,lock=false){
  const unique=[...new Set(ids.filter(Boolean))].sort();if(!unique.length)return new Map();
  let rows;
  if(lock){
    // Lock in a stable order. Count ownership in a fresh statement after waiting
    // for other settlements, so income always uses the latest committed owner.
    rows=(await db.query('SELECT p.id,p.coin_balance,p.coin_income_at,p.coin_income_remainder,p.army_level FROM world_players p WHERE p.id=ANY($1::uuid[]) ORDER BY p.id FOR UPDATE OF p',[unique])).rows;
    const owned=new Map((await db.query('SELECT owner_id,count(*)::int AS owned FROM world_areas WHERE owner_id=ANY($1::uuid[]) GROUP BY owner_id',[unique])).rows.map(row=>[row.owner_id,row.owned]));
    rows=rows.map(row=>({...row,owned:owned.get(row.id)||0}));
  }else rows=(await db.query('SELECT p.id,p.coin_balance,p.coin_income_at,p.coin_income_remainder,p.army_level,(SELECT count(*)::int FROM world_areas a WHERE a.owner_id=p.id) AS owned FROM world_players p WHERE p.id=ANY($1::uuid[])',[unique])).rows;
  return new Map(rows.map(row=>[row.id,projectWallet(row,at)]));
}
function settleAmounts(stakes,winnerOwner,status,cpuRewardAvailable,cpuRewardCoins=RULES.cpuReward){
  const changes=new Map(stakes.map(s=>[s.playerId,0n])),transfers=[];
  const finished=['won','lost','abandoned'].includes(status),winner=stakes.find(s=>s.owner===winnerOwner);
  if(finished)for(const loser of stakes){
    if(loser.owner===winnerOwner)continue;
    const amount=winnerOwner===2&&!winner?loser.stake:winner?winner.stake<loser.stake?winner.stake:loser.stake:0n;
    if(!amount)continue;
    changes.set(loser.playerId,changes.get(loser.playerId)-amount);
    if(winner)changes.set(winner.playerId,changes.get(winner.playerId)+amount);
    transfers.push({fromId:loser.playerId,fromOwner:loser.owner,toId:winner?.playerId||null,toOwner:winnerOwner,amount:coins(amount)});
  }
  const reward=finished&&status==='won'&&winner&&cpuRewardAvailable?BigInt(cpuRewardCoins)*CENTS:0n;
  return {changes,transfers,reward,winner};
}
async function settleEconomy(db,battle,roster,{winnerOwner,status,area,at}){
  const wallets=await readWallets(db,roster.map(p=>p.playerId),at,true);
  const stakes=roster.map(p=>{const stake=battle.stakes.get(p.owner);if(stake?.playerId!==p.playerId||stake.rejected)throw Error('Reserva de moedas inválida.');return {...p,...stake};});
  for(const stake of stakes)if(!stake.playerId||typeof stake.stake!=='bigint')throw Error('Reserva de moedas ausente.');
  const {changes,transfers,reward,winner}=settleAmounts(stakes,winnerOwner,status,!area.owner_id&&!area.cpu_reward_claimed,battle.cpuReward??RULES.cpuReward);
  const date=new Date(at).toISOString();
  async function ledger(playerId,kind,amount){if(amount!==0n)await db.query('INSERT INTO world_coin_ledger(id,player_id,battle_id,kind,amount,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),playerId,battle.id,kind,amount.toString(),date]);}
  for(const stake of stakes){
    const wallet=wallets.get(stake.playerId),change=changes.get(stake.playerId)||0n,bonus=winner?.playerId===stake.playerId?reward:0n;
    const balance=wallet.balance+change+bonus;if(balance<0n)throw Error('A reserva de moedas excedeu o saldo.');
    await db.query('UPDATE world_players SET coin_balance=$1,coin_income_at=$2,coin_income_remainder=$3 WHERE id=$4',[balance.toString(),new Date(wallet.at).toISOString(),wallet.remainder.toString(),stake.playerId]);
    await ledger(stake.playerId,'production',wallet.produced);
    await ledger(stake.playerId,winnerOwner===2&&!winner?'cpu_loss':'battle_loot',change);
    await ledger(stake.playerId,'cpu_reward',bonus);
  }
  if(reward)await db.query('UPDATE world_areas SET cpu_reward_claimed=true WHERE id=$1',[battle.areaId]);
  return {lootPercent:RULES.lootPercent,cpuReward:coins(reward),transfers,
    participants:stakes.map(s=>({playerId:s.playerId,owner:s.owner,balanceAtEntry:coins(s.balance),atRisk:coins(s.stake),change:coins((changes.get(s.playerId)||0n)+(winner?.playerId===s.playerId?reward:0n))}))};
}
module.exports={RULES,coins,stakeFor,projectWallet,readWallets,settleAmounts,settleEconomy};
