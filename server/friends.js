'use strict';
const {randomUUID}=require('node:crypto');
const {HttpError}=require('./auth');
const {levelsFor}=require('./progression');
const rules=require('../shared/troop-rules');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
async function friendList(db,playerId,presence,page=1){
 const self=(await db.query('SELECT friend_code FROM world_players WHERE id=$1',[playerId])).rows[0];
 const rows=(await db.query(`SELECT f.id,f.requester_id,f.status,f.created_at,p.id AS player_id,p.display_name AS name,p.username,p.friend_code,p.army_level,p.troop_levels,p.battles_completed
 FROM world_friendships f JOIN world_players p ON p.id=CASE WHEN f.player_a=$1 THEN f.player_b ELSE f.player_a END
 WHERE f.player_a=$1 OR f.player_b=$1 ORDER BY f.created_at DESC,f.id`,[playerId])).rows;
 const project=r=>({id:r.id,status:r.status,direction:r.requester_id===playerId?'outgoing':'incoming',createdAt:r.created_at,player:{id:r.player_id,name:r.name,username:r.username,code:r.friend_code,commanderLevel:rules.commander(levelsFor(r),r.battles_completed).level,...presence(r.player_id)}});
 const accepted=rows.filter(r=>r.status==='accepted').map(project).sort((a,b)=>Number(b.player.online)-Number(a.player.online)||a.player.name.localeCompare(b.player.name));
 const size=20,pages=Math.max(1,Math.ceil(accepted.length/size)),current=Math.min(page,pages);
 return {code:self.friend_code,friends:accepted.slice((current-1)*size,current*size),incoming:rows.filter(r=>r.status==='pending'&&r.requester_id!==playerId).map(project),outgoing:rows.filter(r=>r.status==='pending'&&r.requester_id===playerId).map(project),counts:{total:accepted.length,online:accepted.filter(r=>r.player.online).length},pagination:{page:current,pages}};
}
async function searchPlayers(db,playerId,query){
 const q=String(query||'').trim().replace(/^#/,'');if(q.length<2||q.length>40)throw new HttpError(400,'Digite de 2 a 40 caracteres para buscar.');
 const pattern='%'+q.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%';
 const rows=(await db.query(`SELECT p.id,p.display_name AS name,p.username,p.friend_code AS code,
 f.id AS friendship_id,f.status,f.requester_id FROM world_players p LEFT JOIN world_friendships f ON f.player_a=least(p.id,$1::uuid) AND f.player_b=greatest(p.id,$1::uuid)
 WHERE p.id<>$1 AND (lower(p.username) LIKE $2 OR lower(p.display_name) LIKE $2 OR p.friend_code=$3) ORDER BY p.display_name,p.id LIMIT 20`,[playerId,pattern,q.toUpperCase()])).rows;
 return rows.map(r=>({id:r.id,name:r.name,username:r.username,code:r.code,friendshipId:r.friendship_id,status:r.status||'none',direction:r.requester_id===playerId?'outgoing':'incoming'}));
}
async function requestFriend(db,playerId,targetId){
 if(!UUID.test(targetId||'')||targetId===playerId)throw new HttpError(400,'Escolha outro jogador para convidar.');
 const ids=[playerId,targetId].sort();
 const players=(await db.query('SELECT id FROM world_players WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
 if(players.length!==2)throw new HttpError(404,'Jogador não encontrado.');
 const previous=(await db.query('SELECT id,status,requester_id FROM world_friendships WHERE player_a=$1 AND player_b=$2',[...ids])).rows[0];
 if(previous)return {...previous,alreadyApplied:true};
 const id=randomUUID();await db.query('INSERT INTO world_friendships(id,player_a,player_b,requester_id) VALUES($1,$2,$3,$4)',[id,...ids,playerId]);return {id,status:'pending'};
}
async function changeFriend(db,playerId,id,action){
 if(!UUID.test(id||'')||!['accept','reject','cancel','remove'].includes(action))throw new HttpError(400,'Ação de amizade inválida.');
 const f=(await db.query('SELECT * FROM world_friendships WHERE id=$1 AND (player_a=$2 OR player_b=$2) FOR UPDATE',[id,playerId])).rows[0];
 if(!f)throw new HttpError(404,'Convite não encontrado.');
 const otherId=f.player_a===playerId?f.player_b:f.player_a;
 if(action==='accept'){
  if(f.requester_id===playerId)throw new HttpError(403,'O destinatário precisa aceitar o convite.');
  if(f.status!=='accepted')await db.query("UPDATE world_friendships SET status='accepted',accepted_at=now() WHERE id=$1",[id]);
 }else{
  if(action==='remove'?f.status!=='accepted':f.status!=='pending'||(action==='cancel')!==(f.requester_id===playerId))throw new HttpError(403,'Essa ação não está disponível para você.');
  await db.query('DELETE FROM world_friendships WHERE id=$1',[id]);
 }
 return {saved:true,otherId};
}
async function publicFriendProfile(db,id,presence){
 const row=(await db.query('SELECT id,display_name AS name,username,army_level,troop_levels,battles_completed FROM world_players WHERE id=$1',[id])).rows[0];if(!row)throw new HttpError(404,'Jogador não encontrado.');
 const stats=(await db.query(`SELECT count(*) FILTER(WHERE p.outcome='won')::int AS wins,count(*) FILTER(WHERE p.outcome IN ('lost','left'))::int AS losses FROM world_battle_participants p JOIN world_battles b ON b.id=p.battle_id WHERE p.player_id=$1 AND b.status IN ('won','lost','abandoned')`,[id])).rows[0];
 const areas=(await db.query('SELECT id,name FROM world_areas WHERE owner_id=$1 ORDER BY ordinal',[id])).rows;
 return {id:row.id,name:row.name,username:row.username,commanderLevel:rules.commander(levelsFor(row),row.battles_completed).level,stats,areas,...presence(id)};
}
module.exports={friendList,searchPlayers,requestFriend,changeFriend,publicFriendProfile};
