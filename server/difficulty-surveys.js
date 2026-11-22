'use strict';
const {randomUUID}=require('node:crypto');
const {HttpError}=require('./auth');
async function createDifficultySurveys(db,battle,roster,{status,winnerOwner,at}){
  // Interrupted/expired matches and pure defenders/spectators are not attempts
  // to conquer. Context is frozen at entry, even if this battle changes owner.
  if(!['won','lost','abandoned'].includes(status))return;
  for(const p of roster.filter(p=>p.owner===1||p.owner===3||p.owner===4)){
    await db.query(`INSERT INTO world_difficulty_surveys(id,player_id,area_id,context,battle_id,side,outcome,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(player_id,area_id,context) DO NOTHING`,
    [randomUUID(),p.playerId,battle.areaId,battle.defenderId?'occupied':'cpu',battle.id,p.owner,p.owner===winnerOwner?'won':'lost',new Date(at).toISOString()]);
  }
}
async function pendingDifficultySurveys(db,playerId){
  if(!playerId)return [];
  return (await db.query(`SELECT s.id,s.area_id AS "areaId",a.name AS "areaName",s.context,s.battle_id AS "battleId",s.outcome,s.created_at AS "createdAt"
    FROM world_difficulty_surveys s JOIN world_areas a ON a.id=s.area_id WHERE s.player_id=$1 AND s.rating IS NULL ORDER BY s.created_at,s.id LIMIT 20`,[playerId])).rows;
}
async function answerDifficultySurvey(db,playerId,id,rating,at){
  if(!Number.isInteger(rating)||rating<1||rating>5)throw new HttpError(400,'Escolha uma dificuldade de 1 a 5 estrelas.');
  const row=(await db.query('SELECT rating FROM world_difficulty_surveys WHERE id=$1 AND player_id=$2 FOR UPDATE',[id,playerId])).rows[0];
  if(!row)throw new HttpError(404,'Avaliação não encontrada para esta conta.');
  if(row.rating!==null){
    if(row.rating!==rating)throw new HttpError(409,'Esta dificuldade já foi avaliada.');
    return {saved:true,alreadyApplied:true};
  }
  await db.query('UPDATE world_difficulty_surveys SET rating=$3,answered_at=$4 WHERE id=$1 AND player_id=$2',[id,playerId,rating,new Date(at).toISOString()]);
  return {saved:true};
}
module.exports={createDifficultySurveys,pendingDifficultySurveys,answerDifficultySurvey};
