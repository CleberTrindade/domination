'use strict';
const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function narrationScripts(){
 const source=fs.readFileSync(require.resolve('../public/world-tutorial.js'),'utf8');
 const tours=vm.runInNewContext(source.match(/const tours=(\[[\s\S]*?\n \]);/)[1]);
 const lessons=require('../shared/training-battle').lessons;
 const special=[
  {title:'Preparando o treinamento',text:'Preparando seu campo de treinamento…'},
  {title:'Treinamento concluído!',text:'Você venceu sua batalha de teste. Agora vamos conhecer as telas e recursos do Mundo Aberto. Esta partida não altera suas moedas, cartas ou estatísticas.'},
  {title:'Treino indisponível',text:'O treino não carregou. Pause e tente novamente pelo Menu → Tutorial guiado.'}
 ];
 return [...lessons,...tours,...special].map(({title,text})=>{const transcript=title+'. '+text,hash=crypto.createHash('sha256').update(transcript).digest('hex');return {text:transcript,sha256:hash,file:hash.slice(0,16)+'.mp3'};});
}
if(require.main===module)process.stdout.write(JSON.stringify(narrationScripts(),null,2));
module.exports={narrationScripts};
