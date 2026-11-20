'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectWallet,stakeFor,settleAmounts,coins}=require('../server/economy');
const entry=(owner,balance)=>({playerId:'player-'+owner,owner,balance:BigInt(balance)*100n,stake:stakeFor(BigInt(balance)*100n)});
test('loot is symmetric, capped by the smaller stake, and transferred once per loser',()=>{
  for(const [first,second,expected]of [[1000,5000,400],[5000,1000,400],[5000,5000,2000],[1,5000,0],[2,1000,0],[3,5000,1],[80,5000,32],[99,5000,39]]){
    for(const winner of [1,2]){
      const result=settleAmounts([entry(1,first),entry(2,second)],winner,'won',false);
      assert.equal(result.changes.get('player-'+winner),BigInt(expected)*100n);
      assert.equal([...result.changes.values()].reduce((sum,n)=>sum+n,0n),0n);
    }
  }
  const result=settleAmounts([entry(1,1000),entry(2,5000),entry(3,2000),entry(4,3000)],1,'won',false);
  assert.equal(result.changes.get('player-1'),120000n);assert.equal(result.transfers.length,3);
  assert([...result.changes.values()].filter(n=>n<0n).every(n=>n===-40000n));
});
test('zero-balance defense, CPU rewards, losses and interruptions have explicit settlement rules',()=>{
  for(const winner of [1,2])assert([...settleAmounts([entry(1,1000),entry(2,0)],winner,winner===1?'won':'lost',false).changes.values()].every(n=>n===0n));
  assert.equal(settleAmounts([entry(1,1000)],1,'won',true).reward,30000n);
  for(const reward of [300,450,600])assert.equal(settleAmounts([entry(1,0)],1,'won',true,reward).reward,0n);
  for(const winner of [1,2,3,4]){const result=settleAmounts([entry(1,1000),entry(2,0),entry(3,0),entry(4,80)],winner,'won',false);assert.equal(result.changes.get('player-2'),0n);assert.equal(result.changes.get('player-3'),0n);if(winner===2||winner===3)assert(result.transfers.length===0);}
  assert.equal(settleAmounts([entry(1,1000)],1,'won',false).reward,0n);
  assert.equal(settleAmounts([entry(1,1000)],2,'lost',true).changes.get('player-1'),-40000n);
  for(const status of ['interrupted','expired']){
    const result=settleAmounts([entry(1,1000),entry(2,5000),entry(3,2000)],null,status,true);
    assert([...result.changes.values()].every(n=>n===0n));assert.equal(result.reward,0n);
  }
});
test('offline production retains pending whole-coin production across frequent settlements and counts every owned area',()=>{
  const start=Date.parse('2026-11-20T00:00:00Z'),row={id:'owner',coin_balance:'100000',coin_income_at:new Date(start),coin_income_remainder:'0',owned:2};
  assert.equal(projectWallet(row,start+86400000).balance,300000n);
  let current={...row};
  for(let i=1;i<=864;i++){
    const wallet=projectWallet(current,start+i*1000);
    current={...current,coin_balance:wallet.balance,coin_income_at:new Date(wallet.at),coin_income_remainder:wallet.remainder};
  }
  assert.equal(BigInt(current.coin_balance),projectWallet(row,start+864000).balance);
  assert.equal(BigInt(current.coin_income_remainder),projectWallet(row,start+864000).remainder);
  const backwards=projectWallet(current,start);assert.equal(backwards.balance,BigInt(current.coin_balance));assert.equal(backwards.at,start+864000);
  assert.equal(stakeFor(10001n),4000n);assert.equal(stakeFor(8009n),3200n);assert.equal(stakeFor(9999n),3900n);
  const old={...row,coin_balance:'8009',coin_income_remainder:'0',owned:1};
  const normalized=projectWallet(old,start);assert.equal(normalized.balance,8000n);assert.equal(coins(normalized.balance),80);assert.equal(normalized.remainder,9n*86400000n);
  assert.equal(projectWallet(old,start+78624).balance,8100n,'existing nine cents contribute to the next full coin');
  for(let elapsed=0;elapsed<90000;elapsed+=1000){const w=projectWallet(old,start+elapsed);assert.equal(w.balance%100n,0n);assert.equal(w.produced%100n,0n);assert(Number.isInteger(coins(w.balance)));}
});
