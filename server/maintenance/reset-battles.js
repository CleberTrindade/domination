'use strict';
// Run only while the world service is stopped: active matches live in RAM.
// This module is deliberately not exposed through the public HTTP API.
const PREVIEW_SQL=`SELECT
 (SELECT count(*)::int FROM world_players) AS accounts,
 (SELECT count(*)::int FROM world_battles) AS battles,
 (SELECT count(*)::int FROM world_battle_replays) AS replays,
 (SELECT count(*)::int FROM world_army_upgrades) AS upgrades,
 (SELECT count(*)::int FROM world_areas WHERE owner_id IS NOT NULL) AS occupied_areas,
 (SELECT COALESCE(sum(coin_balance),0)::text FROM world_players) AS stored_coin_hundredths,
 (SELECT count(*)::int FROM world_difficulty_surveys) AS surveys,
 (SELECT count(*)::int FROM world_difficulty_surveys WHERE rating IS NOT NULL) AS answered_surveys,
 (SELECT count(*)::int FROM world_friendships) AS friendships`;
function resetStatements({onlyAccounts=false}={}){return [
 "SET LOCAL lock_timeout='10s'",
 "SET LOCAL statement_timeout='30s'",
 'SELECT pg_advisory_xact_lock(482761902)',
 'LOCK TABLE world_players,world_areas,world_battles,world_battle_participants,world_battle_replays,world_army_upgrades,world_coin_ledger,world_daily_rewards,world_card_rewards,world_difficulty_surveys,world_friendships IN ACCESS EXCLUSIVE MODE',
 `INSERT INTO world_reset_events(command,before_counts) SELECT 'reset de batalha',to_jsonb(counts)||jsonb_build_object('mode','${onlyAccounts?'only_accounts':'preserve_surveys'}') FROM (${PREVIEW_SQL}) counts`,
 ...(onlyAccounts?[]:[`UPDATE world_difficulty_surveys s SET battle_context=jsonb_build_object('startedAt',b.started_at,'finishedAt',b.finished_at,'status',b.status,'result',b.result) FROM world_battles b WHERE b.id=s.battle_id`]),
 'TRUNCATE TABLE world_battle_replays,world_card_rewards,world_coin_ledger,world_battle_participants,world_army_upgrades,world_daily_rewards,world_battles'+(onlyAccounts?',world_difficulty_surveys,world_friendships':''),
 'UPDATE world_areas SET owner_id=NULL,conquered_at=NULL,cpu_reward_claimed=false,version=version+1',
 `UPDATE world_players SET coin_balance=0,coin_income_at=now(),coin_income_remainder=0,army_level=1,troop_levels='{"tanque":1,"desliz":1,"heli":1,"canhao":1,"central":1,"batedor":1,"foguetes":1,"blindado":1,"antiaereo":1,"engenheiro":1,"artilharia":1}'::jsonb,battles_completed=0,ground_loadout='["tanque"]'::jsonb,troop_cards='{}'::jsonb,army_formations='[{"id":"initial","name":"Formação 1","troops":["tanque"]}]'::jsonb,active_formation_id='initial',formation_revision=formation_revision+1`,
 ...(onlyAccounts?["UPDATE world_players SET tutorial_phase='training',tutorial_step=0"]:[]),
 PREVIEW_SQL
]};
const RESET_STATEMENTS=Object.freeze(resetStatements());
async function previewReset(pool){return (await pool.query(PREVIEW_SQL)).rows[0];}
async function resetBattles(pool,options){
 const db=await pool.connect();try{await db.query('BEGIN');let result;for(const sql of resetStatements(options))result=await db.query(sql);await db.query('COMMIT');return result.rows[0];}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
module.exports={PREVIEW_SQL,RESET_STATEMENTS,resetStatements,previewReset,resetBattles};
