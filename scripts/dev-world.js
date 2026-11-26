'use strict';
// Local QA only: isolated ephemeral Postgres semantics, no production connection.
const fs=require('node:fs'),{postgres}=require('../test/postgres'),{createApplication}=require('../server'),engine=require('../server/battle-engine');
(async()=>{const db=await postgres(),app=await createApplication({pool:db.pool}),normal=app.server.listeners('request')[0];
 app.server.removeListener('request',normal);app.server.on('request',(req,res)=>{
  const url=new URL(req.url,'http://local');if(url.pathname!=='/__local_field')return normal(req,res);
  const map=engine.maps.pilotList().find(m=>m.id===url.searchParams.get('map'))||engine.maps.pilotList()[1];
  const config={mapId:map.id,centralOwner:2,defenderBaseCount:3,seed:123,defenseVersion:engine.combatRules.defenseVersion},b=engine.createBattle(config);for(let i=0;i<100;i++)b.step(1/30);
  const record={id:'local-layout-review',config,snapshot:b.snapshot(),playerOwner:1,attackerName:'Revisão local',defenderName:'CPU',maxOwners:4};
  const extra='<script>addEventListener("load",()=>{setTimeout(()=>window.DOMINATION_WORLD_BRIDGE.start('+JSON.stringify(record)+',()=>false),300)});</script>';
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync('public/index.html','utf8').replace('</body>',extra+'</body>'));
 });
 const port=Number(process.env.PORT||4173);app.server.listen(port,'0.0.0.0',()=>console.log('Local world pilot: http://127.0.0.1:'+port));
 const stop=async()=>{await app.close();await db.destroy();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
})().catch(e=>{console.error(e);process.exit(1);});
