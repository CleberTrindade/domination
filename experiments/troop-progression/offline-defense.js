/* Experimental owner-level defense, using the current occupied-area setup.
 * No accounts, live battles or game rules are changed.
 * node experiments/troop-progression/offline-defense.js
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {simulate,validateBaseline,cases}=require('./simulate');
const original=require('../../server/battle-engine');
const levels=[1,5,10],policies=['simple','coordinated'],results=[],count=50,start=3001;
const power=level=>1+.1*(level-1);
const rate=rows=>(100*rows.filter(r=>r.win).length/rows.length).toFixed(1).replace('.',',')+'%';
validateBaseline();
const started=Date.now();
for(const attackerLevel of levels)for(const ownerLevel of levels){
  let wins=0;
  for(const area of cases)for(const policy of policies)for(let seed=start;seed<start+count;seed++){
    const result=simulate({...area,share:.5},attackerLevel,power(ownerLevel)/power(attackerLevel),seed,policy,'attacker');
    results.push({...result,attackerLevel,ownerLevel});wins+=result.win;
  }
  process.stdout.write(JSON.stringify({attackerLevel,ownerLevel,wins,total:500,elapsedSeconds:Math.round((Date.now()-started)/1000)})+'\n');
}
assert.equal(results.length,4500);assert(results.every(r=>['won','lost'].includes(r.result)&&r.seconds<=360.04));
fs.writeFileSync(path.join(__dirname,'offline-defense-results.json'),JSON.stringify({start,count,model:'Occupied areas, share 50%, original area difficulty/production/CPU decisions; player and owner keep their own linear combat levels; neutral strength scales with attacker; no human takeover or late entrants',results},null,2)+'\n');
const report=[
'# Domination — evolução do proprietário e defesa offline',
'',
'Estudo de 20/11/2026. Pergunta: ao manter a evolução do dono enquanto a CPU defende sua área offline, qual seria a taxa de vitórias do atacante?',
'',
'## Método',
'',
'Foram 4.500 combates experimentais, com atacante nos níveis 1, 5 e 10 e proprietário nos mesmos três níveis: nove pares × cinco perfis de área × duas estratégias de ataque × 50 sementes de 3001 a 3050. Cada célula da tabela principal tem 500 batalhas.',
'',
'A defesa começa com aproximadamente 50% dos hexágonos e o bombardeiro central, conforme a configuração atual de áreas ocupadas. Mantêm-se as tropas iniciais, produção e intervalos de decisão originais de cada setor. A CPU permanece ativa. Vitória exige eliminar bases e tropas, no limite de seis minutos. Não há entrada de invasores ou retorno do dono para assumir a defesa.',
'',
'O poder proposto do nível n é `1 + 0,10 × (n − 1)`. O atacante usa seu poder e a defesa usa o poder integral do proprietário, sem receber o desconto de 60%–85% usado nos testes de guarnições sem dono. As bases neutras acompanham a força de referência do atacante, como no modelo anterior. A inteligência e a produção mantêm os perfis atuais; não foram calibradas para o alvo de vitórias.',
'',
'A evolução ainda é um protótipo carregado em uma cópia do motor em memória. Estes dados não são taxas observadas de partidas humanas nem representam um balanceamento final publicado.',
'',
'## Vitórias do atacante',
'',
'| Nível do atacante | Dono nível 1 | Dono nível 5 | Dono nível 10 |',
'| --- | ---: | ---: | ---: |',
];
for(const attackerLevel of levels)report.push('| '+attackerLevel+' | '+levels.map(ownerLevel=>rate(results.filter(r=>r.attackerLevel===attackerLevel&&r.ownerLevel===ownerLevel))).join(' | ')+' |');
report.push('',
'## Confrontos de mesmo nível por área',
'',
'Cada célula contém 100 combates, somando as duas estratégias e as 50 sementes.',
'',
'| Área | Ambos nível 1 | Ambos nível 5 | Ambos nível 10 |',
'| --- | ---: | ---: | ---: |',
);
for(const area of cases)report.push('| '+area.name+' | '+levels.map(level=>rate(results.filter(r=>r.area===area.name&&r.attackerLevel===level&&r.ownerLevel===level))).join(' | ')+' |');
report.push('',
'## Condições iniciais da defesa ocupada',
'',
'| Área | Bases da defesa | Tropas da defesa | Tropas do atacante |',
'| --- | ---: | ---: | ---: |',
);
for(const area of cases){const s=original.createBattle({...area,share:.5,centralOwner:2}).snapshot(),defense=s.sites.filter(b=>b.owner===2);report.push(`| ${area.name} | ${defense.length} | ${defense.reduce((n,b)=>n+b.troops,0)} | 38 |`);}
report.push('',
'## Como interpretar',
'',
'Não existe uma taxa única de vitória associada a "dono offline". A vantagem territorial e as evoluções dos dois lados alteram o confronto. Manter o nível do dono preserva seu investimento, mas não garante que a atual configuração de tropas, produção e ocupação esteja equilibrada.',
'',
'A faixa de 60%–83% pode orientar o balanceamento das guarnições de áreas sem dono. Para defesa offline de jogadores, qualquer meta deve especificar confronto de níveis equivalentes e calibrar as vantagens iniciais e a inteligência da defesa. Aplicar a mesma faixa a qualquer diferença de evolução exigiria compensar níveis desiguais e reduzir o efeito estratégico da evolução.',
'',
'Proposta ainda não calibrada: tratar a defesa offline de um proprietário de força semelhante como confronto difícil, buscando 60%–69% de vitórias do atacante. Essa faixa é um objetivo de design, não o resultado medido acima. Diante de um dono mais evoluído, a taxa pode ser menor; diante de um dono menos evoluído, pode ser maior. Ajustar a vantagem territorial inicial e as decisões da CPU preservando o poder real das tropas do dono.',
'',
'Dificuldade e recompensa de áreas da CPU podem ter faixas distintas, acessíveis livremente no mundo aberto. Para uma área de jogador, dificuldade depende também da evolução do dono; a recompensa já inclui o saque limitado pela reserva dos participantes e a posse da área. Bônus de primeira conquista da CPU e saque de jogadores são regras diferentes.',
'',
'O resultado acima é diagnóstico. Não configura uma meta de 60%–83% já atingida para defesas offline e não justifica enfraquecer automaticamente as tropas compradas pelo proprietário. Antes de implementar, é necessário escolher uma meta para níveis equivalentes e calibrar defesa inicial, produção e decisões sem alterar forças durante a batalha.',
'',
'## Reprodução',
'',
'```sh',
'node experiments/troop-progression/offline-defense.js',
'```',
);
fs.writeFileSync(path.join(__dirname,'DEFESA_OFFLINE.md'),report.join('\n')+'\n');
process.stdout.write('Saved 4,500 results and DEFESA_OFFLINE.md.\n');
