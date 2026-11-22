'use strict';
const {HttpError}=require('./auth');
async function readTutorial(pool,playerId){
 if(!playerId)return null;
 const row=(await pool.query('SELECT tutorial_phase,tutorial_step FROM world_players WHERE id=$1',[playerId])).rows[0];
 return {phase:row.tutorial_phase,step:row.tutorial_step};
}
async function saveTutorial(pool,playerId,input){
 if(!['tour','done'].includes(input.phase)||!Number.isInteger(input.step)||input.step<0||input.step>30)throw new HttpError(400,'Etapa de tutorial inválida.');
 // Progress is monotonic. Retrying an old tab cannot reopen completed onboarding.
 await pool.query(`UPDATE world_players SET tutorial_phase=$2,tutorial_step=$3 WHERE id=$1 AND
 ((tutorial_phase='training' AND $2='tour' AND $3=0) OR
 (tutorial_phase='tour' AND ($2='done' OR ($2='tour' AND tutorial_step<=$3))))`,[playerId,input.phase,input.step]);
 return {tutorial:await readTutorial(pool,playerId)};
}
module.exports={readTutorial,saveTutorial};
