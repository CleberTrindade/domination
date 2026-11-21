'use strict';
const fs=require('node:fs'),path=require('node:path');
function mapModule(){return "(function(){const module={exports:{}};const require=()=>("+JSON.stringify(require('../shared/map.json'))+");\n"+fs.readFileSync(path.join(__dirname,'../shared/battle-maps.js'),'utf8')+"\nreturn module.exports;})()";}
function browserMaps(){return 'self.DOMINATION_MAPS='+mapModule()+';';}
function browserEngine(){
  const source=fs.readFileSync(path.join(__dirname,'battle-engine.js'),'utf8');
  return '(function(){const catalog='+mapModule()+';const module={exports:{}};const require=()=>catalog;\n'+source+'\nself.DOMINATION_ENGINE=module.exports;})();';
}
module.exports={browserEngine,browserMaps};
