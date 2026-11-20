'use strict';
const fs=require('node:fs'),path=require('node:path');
function browserEngine(){
  const source=fs.readFileSync(path.join(__dirname,'battle-engine.js'),'utf8');
  const map=JSON.stringify(require('../shared/map.json'));
  return '(function(){const module={exports:{}};const require=()=>('+map+');\n'+source+'\nself.DOMINATION_ENGINE=module.exports;})();';
}
module.exports={browserEngine};
