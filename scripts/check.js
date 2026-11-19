const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
for(const file of ['server/index.js','server/world-service.js','server/battle-engine.js','server/auth.js','server/database.js','public/world.js'])new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
const html=fs.readFileSync('public/index.html','utf8');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const map=JSON.parse(html.match(/const MAPDATA=(.*?);\n/)[1]);assert.deepEqual(map,require('../shared/map.json'));
assert(!html.includes('wss://domination-ws.onrender.com'));
console.log('Client/server syntax, shared map and isolated online endpoint validated.');
