'use strict';
const {coins}=require('./economy');
// Include legacy matches saved before the participant roster existed. Each
// player appears once per match, including automatic defense while offline.
const MATCHES=`WITH mine AS (
  SELECT b.*,p.side,p.outcome,p.army_level FROM world_battle_participants p
  JOIN world_battles b ON b.id=p.battle_id WHERE p.player_id=$1 AND b.status<>'active'
  UNION ALL
  SELECT b.*,CASE WHEN b.attacker_id=$1 THEN 1 ELSE 2 END AS side,
    CASE WHEN b.winner_id=$1 OR (b.winner_id IS NULL AND ((b.attacker_id=$1 AND b.status='won') OR (b.defender_id=$1 AND b.status IN ('lost','abandoned')))) THEN 'won' ELSE 'lost' END AS outcome,
    NULL::smallint AS army_level
  FROM world_battles b WHERE (b.attacker_id=$1 OR b.defender_id=$1) AND b.status<>'active'
    AND NOT EXISTS(SELECT 1 FROM world_battle_participants p WHERE p.battle_id=b.id AND p.player_id=$1)
), personal AS (SELECT mine.*,CASE WHEN status IN ('interrupted','expired') THEN 'cancelled' WHEN outcome='left' THEN 'left' ELSE outcome END AS personal_outcome FROM mine)`;
async function playerProfile(pool,player,page){
  const pageSize=20;
  const stats=(await pool.query(MATCHES+` SELECT count(*)::int AS total,
    count(*) FILTER(WHERE personal_outcome='won')::int AS wins,
    count(*) FILTER(WHERE personal_outcome='lost')::int AS losses,
    count(*) FILTER(WHERE personal_outcome='left')::int AS withdrawals,
    count(*) FILTER(WHERE personal_outcome='cancelled')::int AS cancelled FROM personal`,[player.id])).rows[0];
  const pages=Math.max(1,Math.ceil(stats.total/pageSize)),currentPage=Math.min(page,pages);
  const rows=(await pool.query(MATCHES+` SELECT m.id,m.area_id,a.name AS area_name,m.status,m.personal_outcome AS outcome,m.side,m.army_level,m.started_at,m.finished_at,
    attacker.display_name AS attacker_name,defender.display_name AS defender_name,winner.display_name AS winner_name,
    m.result->'balance'->>'defenderParticipated' AS defender_participated,m.result->'balance'->'armies' AS army_profiles,
    (SELECT COALESCE(sum(l.amount),0)::text FROM world_coin_ledger l WHERE l.battle_id=m.id AND l.player_id=$1 AND l.kind IN ('battle_loot','cpu_loss','cpu_reward')) AS coin_change
    FROM personal m JOIN world_areas a ON a.id=m.area_id
    JOIN world_players attacker ON attacker.id=m.attacker_id
    LEFT JOIN world_players defender ON defender.id=m.defender_id
    LEFT JOIN world_players winner ON winner.id=m.winner_id
    ORDER BY m.finished_at DESC,m.id DESC LIMIT $2 OFFSET $3`,[player.id,pageSize,(currentPage-1)*pageSize])).rows;
  const account=(await pool.query('SELECT created_at FROM world_players WHERE id=$1',[player.id])).rows[0];
  const decided=stats.wins+stats.losses+stats.withdrawals;
  return {player:{id:player.id,name:player.display_name,username:player.username,createdAt:account.created_at},
    stats:{...stats,winRate:decided?Math.round(stats.wins/decided*100):null},
    pagination:{page:currentPage,pageSize,pages,total:stats.total},
    matches:rows.map(({army_profiles,...row})=>({...row,troop_levels:(Array.isArray(army_profiles)?army_profiles.find(a=>a.owner===row.side)?.troops:null)||null,role:row.side===1?'attacker':row.side===2?'defender':'invader',coin_change:coins(BigInt(row.coin_change)),
      automatic_defense:row.side===2&&row.defender_participated==='false'}))};
}
module.exports={playerProfile};
