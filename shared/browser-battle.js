(function(root){
  'use strict';
  const STEP=1/30,MAX_FRAMES=11000;
  function createBrowserBattle(factory,record){
    let engine,frames=0,inputs=[],seen=new Set(),controlled=false,accumulator=0;
    const tickets=new Map((record.authorizedInputs||[]).map(input=>[input.nonce,input]));
    const baseline=record.config;
    function reset(){engine=factory.createBattle(baseline);frames=0;controlled=false;engine.setDefenderControlled(false);}
    reset();
    if(record.resume){
      engine=factory.restoreBattle(record.resume.checkpoint);frames=record.resume.frames;
      inputs=record.resume.inputs.slice();controlled=!!record.resume.controlled;
      engine.setDefenderControlled(controlled);seen=new Set(inputs.map(i=>i.nonce));
    }
    function apply(input){
      if(input.kind==='control'){controlled=input.controlled;engine.setDefenderControlled(controlled);return true;}
      if(input.kind==='join')return engine.join(input.owner,input.site);
      if(input.kind==='leave')return engine.leave(input.owner);
      return engine.command(input.command,input.owner);
    }
    return {
      input(input){
        if(seen.has(input.nonce))return null;
        tickets.set(input.nonce,input);
        seen.add(input.nonce);const accepted=apply(input);inputs.push({nonce:input.nonce,frame:frames,accepted});return accepted;
      },
      outcome(nonce){return inputs.find(input=>input.nonce===nonce)?.accepted;},
      reject(nonce){
        if(!seen.has(nonce))return;
        const target=frames,remaining=inputs.filter(input=>input.nonce!==nonce);reset();
        for(const action of remaining){while(frames<action.frame){engine.step(STEP);frames++;}apply(tickets.get(action.nonce));}
        while(frames<target){engine.step(STEP);frames++;}
        inputs=remaining;seen=new Set(inputs.map(input=>input.nonce));accumulator=0;
      },
      advance(seconds){
        accumulator+=Math.min(1,Math.max(0,seconds));
        while(accumulator>=STEP&&!engine.result&&frames<MAX_FRAMES){engine.step(STEP);frames++;accumulator-=STEP;}
        if(engine.result)accumulator=0;
      },
      checkpoint(){return {frames,inputs:inputs.slice(),controlled,checkpoint:engine.checkpoint()};},
      snapshot(){return engine.snapshot();},
      completion(){return {frames,inputs:inputs.slice()};},
      get over(){return !!engine.result;}
    };
  }
  // Executed once, at completion. No live server simulation and no DB access.
  function verifyBrowserBattle(factory,config,authorized,completion,maxFrames=MAX_FRAMES){
    if(!completion||!Number.isInteger(completion.frames)||completion.frames<0||completion.frames>maxFrames||!Array.isArray(completion.inputs)||completion.inputs.length!==authorized.size)throw Error('Há ordens pendentes ou o encerramento é inválido.');
    const engine=factory.createBattle(config),seen=new Set(),validatedParticipants=[];let frame=0;
    for(const action of completion.inputs){
      const input=authorized.get(action.nonce);
      if(!input||seen.has(action.nonce)||!Number.isInteger(action.frame)||action.frame<frame||action.frame>completion.frames)throw Error('Sequência de ordens inválida.');
      while(frame<action.frame){engine.step(STEP);frame++;}
      if(input.kind==='control')engine.setDefenderControlled(input.controlled);
      else if(input.kind==='join'){
        const accepted=engine.join(input.owner,input.site);
        if(accepted)validatedParticipants.push({playerId:input.playerId,name:input.playerName,owner:input.owner,joinedAt:input.joinedAt});
        if(accepted!==action.accepted)throw Error('Entrada de participante inválida.');
      }else if(input.kind==='leave')engine.leave(input.owner);
      else engine.command(input.command,input.owner);
      seen.add(action.nonce);
    }
    while(frame<completion.frames){engine.step(STEP);frame++;}
    if(!engine.result)throw Error('A batalha ainda não terminou.');
    return {...engine.snapshot(),validatedParticipants};
  }
  const api={createBrowserBattle,verifyBrowserBattle,STEP,MAX_FRAMES};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.DOMINATION_BROWSER_BATTLE=api;
})(typeof self==='object'?self:globalThis);
