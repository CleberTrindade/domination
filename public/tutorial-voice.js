'use strict';
/* Narration uses the voices provided by the browser/device; no microphone. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createTutorialVoice=factory;})(typeof window==='object'?window:this,function({synthesis,Utterance,onChange=()=>{}}={}){
 const supported=!!synthesis&&typeof Utterance==='function';
 let enabled=false,speaking=false,text='',generation=0,error='';
 const state=()=>({supported,enabled,speaking,error});
 const changed=()=>onChange(state());
 function silence(){generation++;speaking=false;if(supported)try{synthesis.cancel();}catch{}changed();}
 function play(){
  silence();if(!enabled||!text||!supported)return;error='';
  let voices=[];try{voices=synthesis.getVoices()||[];}catch{}
  const portuguese=voice=>/^pt(?:[-_]|$)/i.test(voice.lang||'');
  const voice=voices.find(v=>/^pt[-_]BR$/i.test(v.lang))||voices.find(portuguese);
  if(voices.length&&!voice){error='Não há voz em português disponível neste aparelho.';enabled=false;changed();return;}
  // Short utterances avoid long-paragraph limits on mobile speech engines.
  const chunks=text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[text],id=generation;
  function next(index){
   if(id!==generation||!enabled)return;
   if(index>=chunks.length){speaking=false;changed();return;}
   const utterance=new Utterance(chunks[index].trim());utterance.lang='pt-BR';utterance.rate=.95;utterance.pitch=1;if(voice)utterance.voice=voice;
   utterance.onend=()=>{if(id===generation)next(index+1);};
   utterance.onerror=()=>{if(id!==generation)return;speaking=false;enabled=false;error='O áudio não pôde ser iniciado. Toque em Ouvir para tentar novamente.';changed();};
   try{speaking=true;changed();synthesis.speak(utterance);}catch{utterance.onerror();}
  }
  next(0);
 }
 return {state,silence,setText(value){if(value===text)return;text=value;silence();if(enabled)play();},toggle(){if(!supported)return;enabled=!enabled;if(enabled)play();else{error='';silence();}},repeat(){if(!supported)return;enabled=true;play();},clear(){text='';error='';silence();}};
});
