'use strict';
const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const hashToken = token => createHash('sha256').update(token).digest('hex');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}
async function passwordMatches(password, stored) {
  const [salt, digest] = stored.split(':');
  const expected = Buffer.from(digest, 'hex');
  const actual = await derive(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
const publicPlayer = player => player ? { id: player.id, username: player.username, name: player.display_name } : null;
function sessionToken(req) {
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('domination_session='))?.slice(19) || '';
}
async function getPlayer(pool, req) {
  const token = sessionToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return (await pool.query('SELECT p.id,p.username,p.display_name FROM world_sessions s JOIN world_players p ON p.id=s.player_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hashToken(token)])).rows[0] || null;
}
async function authenticate(pool, req, res, action, input, secure) {
  if (action === 'logout') {
    const token = sessionToken(req);
    if (token) await pool.query('DELETE FROM world_sessions WHERE token_hash=$1', [hashToken(token)]);
    res.setHeader('Set-Cookie', 'domination_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : ''));
    return { player: null };
  }
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 8 || password.length > 128) throw new HttpError(400, 'Use um usuário com 3 a 24 letras, números ou _, e uma senha de 8 a 128 caracteres.');
  let player;
  if (action === 'register') {
    const name = typeof input.name === 'string' ? input.name.trim().replace(/[\u0000-\u001f<>]/g, '') : '';
    if (name.length < 2 || name.length > 24) throw new HttpError(400, 'Escolha um nome de comandante com 2 a 24 caracteres.');
    try {
      player = (await pool.query('INSERT INTO world_players(id,username,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING id,username,display_name', [randomUUID(), username, name, await passwordHash(password)])).rows[0];
    } catch (error) { if (error.code === '23505') throw new HttpError(409, 'Esse usuário já está em uso.'); throw error; }
  } else if (action === 'login') {
    const found = (await pool.query('SELECT id,username,display_name,password_hash FROM world_players WHERE username=$1', [username])).rows[0];
    // Run scrypt even for unknown accounts, keeping the response shape uniform.
    const stored = found?.password_hash || '00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await passwordMatches(password, stored);
    if (!found || !valid) throw new HttpError(401, 'Usuário ou senha incorretos.');
    player = found;
  } else throw new HttpError(404, 'Ação não encontrada.');
  const token = randomBytes(32).toString('hex');
  const previous = sessionToken(req);
  if (previous) await pool.query('DELETE FROM world_sessions WHERE token_hash=$1', [hashToken(previous)]);
  await pool.query("INSERT INTO world_sessions(token_hash,player_id,expires_at) VALUES($1,$2,now()+interval '30 days')", [hashToken(token), player.id]);
  res.setHeader('Set-Cookie', 'domination_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000' + (secure ? '; Secure' : ''));
  return { player: publicPlayer(player) };
}
module.exports = { HttpError, getPlayer, authenticate, publicPlayer, sessionToken };
