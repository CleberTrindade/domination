'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {postgres}=require('./postgres'),{migrate}=require('../server/database'),{projectWallet}=require('../server/economy');
test('whole-coin migration preserves fractional credit and historical audits and runs only once',async()=>{
  const database=await postgres(),pool=database.pool,folder=path.join(__dirname,'../server/migrations');
  try{
    await pool.query('CREATE TABLE world_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
    for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.sql')&&n<'009').sort()){
      await pool.query(fs.readFileSync(path.join(folder,name),'utf8'));await pool.query('INSERT INTO world_migrations(name) VALUES($1)',[name]);
    }
    const player=randomUUID(),battle=randomUUID(),at='2026-11-20T12:00:00Z';
    await pool.query('INSERT INTO world_players(id,username,display_name,password_hash,coin_balance,coin_income_at,coin_income_remainder) VALUES($1,$2,$3,$4,8009,$5,47)',[player,'legacy_coins','Legacy','unused-test-hash',at]);
    await pool.query("INSERT INTO world_battles(id,area_id,attacker_id,area_version,status,defense_share,started_at,finished_at,expires_at) VALUES($1,'se-agreste',$2,0,'lost',.23,$3,$3,$3)",[battle,player,at]);
    await pool.query("INSERT INTO world_coin_ledger(id,player_id,battle_id,kind,amount,created_at) VALUES($1,$2,$3,'cpu_loss',-9,$4)",[randomUUID(),player,battle,at]);
    await migrate(pool);
    const row=(await pool.query('SELECT * FROM world_players WHERE id=$1',[player])).rows[0];
    assert.equal(BigInt(row.coin_balance),8000n);assert.equal(BigInt(row.coin_income_remainder),9n*86400000n+47n);
    assert.equal(projectWallet({...row,owned:1},Date.parse(at)+78624).balance,8100n);
    assert.equal(BigInt((await pool.query('SELECT amount FROM world_coin_ledger WHERE battle_id=$1',[battle])).rows[0].amount),-9n,'audit amounts remain unchanged');
    await assert.rejects(pool.query('UPDATE world_players SET coin_balance=8009 WHERE id=$1',[player]),e=>e.code==='23514');
    await assert.rejects(pool.query("INSERT INTO world_coin_ledger(id,player_id,battle_id,kind,amount,created_at) VALUES($1,$2,$3,'production',9,$4)",[randomUUID(),player,battle,at]),e=>e.code==='23514');
    await migrate(pool);const again=(await pool.query('SELECT coin_balance,coin_income_remainder FROM world_players WHERE id=$1',[player])).rows[0];
    assert.equal(BigInt(again.coin_balance),8000n);assert.equal(BigInt(again.coin_income_remainder),BigInt(row.coin_income_remainder));
  }finally{await database.destroy();}
});
