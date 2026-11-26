'use strict';
const fs=require('node:fs'),path=require('node:path');
function mapModule(){return `(function(){const module={exports:{}};const require=p=>p==='./pilot-maps.json'?${JSON.stringify(require('../shared/pilot-maps.json'))}:p==='./pilot-maps-v1.json'?${JSON.stringify(require('../shared/pilot-maps-v1.json'))}:${JSON.stringify(require('../shared/map.json'))};\n${fs.readFileSync(path.join(__dirname,'../shared/battle-maps.js'),'utf8')}\nreturn module.exports;})()`;}
function browserMaps(){return 'self.DOMINATION_MAPS='+mapModule()+';';}
function browserEngine(){
 const source=fs.readFileSync(path.join(__dirname,'battle-engine.js'),'utf8');
 return '(function(){const catalog='+mapModule()+';const bundledTroopRules=(function(){const module={exports:{}};'+fs.readFileSync(path.join(__dirname,'../shared/troop-rules.js'),'utf8')+';return module.exports;})();const module={exports:{}};const require=p=>p.includes("troop-rules")?bundledTroopRules:catalog;\n'+source+'\nself.DOMINATION_ENGINE=module.exports;})();';
}
module.exports={browserEngine,browserMaps};
