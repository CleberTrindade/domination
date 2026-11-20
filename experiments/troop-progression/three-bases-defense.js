/* Three established defender bases PLUS the central bombarder (four sites).
 * node experiments/troop-progression/three-bases-defense.js
 * Reuses the paired seeds from offline-defense.js. No live game changes.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {factory,simulate,validateBaseline,cases}=require('./simulate');
const levels=[1,5,10],policies=['simple','coordinated'],results=[],initial=[],count=50,start=3001;
const power=level=>1+.1*(level-1),rate=rows=>(100*rows.filter(r=>r.win).length/rows.length).toFixed(1).replace('.',',')+'%';
validateBaseline();
for(const area of cases){
  const previous=factory.createBattle({...area,share:.5,centralOwner:2}).snapshot();
  const next=factory.createBattle({...area,share:.5,centralOwner:2,defenderBaseCount:3}).snapshot(),sites=next.sites.filter(s=>s.owner===2);
  assert.equal(sites.length,4);assert.equal(next.sites[0].owner,2);assert.equal(next.sites[4].owner,1);assert.equal(next.sites[4].troops,38);
  assert.equal(JSON.stringify(previous.par),JSON.stringify(next.par));
  for(const site of sites)assert.equal(site.troops,previous.sites[site.id].troops);
  assert.equal(JSON.stringify(sites.map(s=>s.id)),JSON.stringify([0,1,5,7]));
  initial.push({area:area.name,defenderPositions:sites.map(s=>s.id),defenderTroops:sites.reduce((n,s)=>n+s.troops,0),previousDefenderTroops:previous.sites.filter(s=>s.owner===2).reduce((n,s)=>n+s.troops,0),share:next.defenderShare});
}
const started=Date.now();
for(const attackerLevel of levels)for(const ownerLevel of levels){
  let wins=0;
  for(const area of cases)for(const policy of policies)for(let seed=start;seed<start+count;seed++){
    const result=simulate({...area,share:.5},attackerLevel,power(ownerLevel)/power(attackerLevel),seed,policy,'attacker',{defenderBaseCount:3});
    results.push({...result,attackerLevel,ownerLevel,actualShare:initial.find(s=>s.area===area.name).share});wins+=result.win;
  }
  process.stdout.write(JSON.stringify({attackerLevel,ownerLevel,wins,total:500,elapsedSeconds:Math.round((Date.now()-started)/1000)})+'\n');
}
assert.equal(results.length,4500);assert(results.every(r=>['won','lost'].includes(r.result)&&r.seconds<=360.04));
fs.writeFileSync(path.join(__dirname,'three-bases-defense-results.json'),JSON.stringify({start,count,initial,results},null,2)+'\n');
const baselinePath=path.join(__dirname,'offline-defense-results.json');
const baseline=fs.existsSync(baselinePath)?JSON.parse(fs.readFileSync(baselinePath,'utf8')).results:null;
const summary=[];
for(const attackerLevel of levels)for(const ownerLevel of levels)for(const area of cases)for(const policy of policies){
  const rows=results.filter(r=>r.attackerLevel===attackerLevel&&r.ownerLevel===ownerLevel&&r.area===area.name&&r.policy===policy);
  const old=baseline?.filter(r=>r.attackerLevel===attackerLevel&&r.ownerLevel===ownerLevel&&r.area===area.name&&r.policy===policy);
  summary.push({area:area.name,attackerLevel,ownerLevel,policy,games:rows.length,wins:rows.filter(r=>r.win).length,previousWins:old?old.filter(r=>r.win).length:'',timeouts:rows.filter(r=>r.reason==='time').length});
}
const keys=Object.keys(summary[0]);fs.writeFileSync(path.join(__dirname,'three-bases-summary.csv'),keys.join(',')+'\n'+summary.map(row=>keys.map(k=>row[k]).join(',')).join('\n')+'\n');
const report=[
'# Domination — três bases estabelecidas mais o bombardeiro central',
'',
'Simulação solicitada por Cleber em 20/11/2026 para testar uma defesa offline com três bases mais o bombardeiro central, preservando as forças por tropa usadas no estudo anterior.',
'',
'## Configuração testada',
'',
'- A defesa começa com **quatro posições no total**: quartel inicial, duas bases mais próximas dele e o bombardeiro central. A seleção foi definida pela distância antes de medir vitórias: IDs 1, 7, 5 e 0, respectivamente. São duas garagens, uma base de botes e o bombardeiro; não foi escolhido um arranjo depois de observar o resultado.',
'- O atacante mantém uma base e 38 tropas iniciais. Cada base mantida da defesa conserva sua quantidade original de tropas. Bases retiradas da defesa voltam a ser neutras, com a guarnição neutra padrão, e podem ser conquistadas por qualquer lado.',
'- A defesa ocupa **23,5% dos hexágonos** nesse arranjo. Não se mantêm os 50% de território do teste anterior: o mapa associa hexágonos às bases, portanto a mudança no número de bases também altera a ocupação.',
'- Produção, capacidades, velocidades, intervalo de decisões da CPU, paraquedas e duração máxima de seis minutos continuam iguais aos testes anteriores. A CPU fica ativa e mantém o bombardeiro no início; capturá-lo não encerra a batalha.',
'- São usados os níveis 1, 5 e 10 do mesmo protótipo de evolução: poder `1 + 0,10 × (nível − 1)`. Cada lado mantém integralmente seu próprio nível; não se aplica redução percentual extra à defesa. O nível 1 corresponde à força atual sem upgrades. Níveis 5 e 10 representam a evolução proposta, ainda não publicada.',
'- Bases neutras acompanham a referência de força do atacante, conforme o estudo anterior. O proprietário não assume a defesa e não há invasores adicionais.',
'',
'Foram 4.500 combates: nove combinações de níveis × cinco perfis de área × duas estratégias de ataque × 50 sementes de 3001 a 3050. As sementes e estratégias são as mesmas da análise anterior com nove bases, permitindo comparação emparelhada. Cada célula da tabela principal representa 500 batalhas.',
'',
'## Tropas e ocupação iniciais',
'',
'| Área | Defesa anterior: nove posições | Nova defesa: três bases + central | Atacante |',
'| --- | ---: | ---: | ---: |',
];
for(const row of initial)report.push(`| ${row.area} | ${row.previousDefenderTroops} | ${row.defenderTroops} | 38 |`);
report.push('',
'## Vitórias do atacante',
'',
'| Nível do atacante | Dono nível 1 | Dono nível 5 | Dono nível 10 |',
'| --- | ---: | ---: | ---: |',
);
for(const attackerLevel of levels)report.push('| '+attackerLevel+' | '+levels.map(ownerLevel=>rate(results.filter(r=>r.attackerLevel===attackerLevel&&r.ownerLevel===ownerLevel))).join(' | ')+' |');
report.push('',
'## Comparação entre níveis iguais',
'',
'| Nível de ambos | Nove posições anteriores | Três bases + central |',
'| --- | ---: | ---: |',
);
for(const level of levels)report.push('| '+level+' | '+(baseline?rate(baseline.filter(r=>r.attackerLevel===level&&r.ownerLevel===level)):'Reexecutar offline-defense.js')+' | '+rate(results.filter(r=>r.attackerLevel===level&&r.ownerLevel===level))+' |');
report.push('',
'## Resultados por área entre níveis iguais',
'',
'Cada célula representa 100 combates, somando as duas estratégias. Este recorte evita esconder diferenças regionais na média.',
'',
'| Área | Ambos nível 1 | Ambos nível 5 | Ambos nível 10 |',
'| --- | ---: | ---: | ---: |',
);
for(const area of cases)report.push('| '+area.name+' | '+levels.map(level=>rate(results.filter(r=>r.area===area.name&&r.attackerLevel===level&&r.ownerLevel===level))).join(' | ')+' |');
report.push('',
'## Leitura em relação à meta',
'',
'A redução de nove posições para três bases mais o bombardeiro aproxima a média entre níveis iguais da faixa geral desejada de 60%–83%. Os níveis 5 e 10 ficam dentro dessa faixa; o nível 1 fica 1,6 ponto percentual acima. Isso não significa que todos os setores já estejam equilibrados: o Litoral Sul permanece em 100% de vitórias dos bots e a Capital varia de 16% a 43%.',
'',
'É uma configuração inicial mais promissora para a média, preservando o nível do dono, mas ainda pede ajuste regional de guarnição, produção e decisões. A escolha das quatro posições também deve ser mantida explícita. A faixa mais restrita de 60%–69% para defesa offline, sugerida anteriormente como possibilidade, não foi atingida nas médias dos três níveis iguais.',
'',
'## Limites da conclusão',
'',
'Os números são frequências de vitórias de dois bots neste protótipo, não uma previsão garantida para jogadores humanos. Reduzir a defesa também muda a localização das posições próprias, a produção total inicial, a ocupação territorial e quais armas neutras passam a atingir cada lado. O resultado é do pacote de três bases mais central, não de uma alteração isolada na força por tropa.',
'',
'Outras escolhas das três bases podem produzir resultados diferentes. A comparação também não cobre o dono voltando para comandar, outros invasores entrando, reconexões ou o impacto econômico de várias batalhas. Não houve alteração no aplicativo publicado nem em dados de jogadores.',
'',
'## Reprodução',
'',
'```sh',
'# Opcional: refazer a referência anterior para preencher a comparação.',
'node experiments/troop-progression/offline-defense.js',
'node experiments/troop-progression/three-bases-defense.js',
'```',
);
fs.writeFileSync(path.join(__dirname,'TRES_BASES_E_CENTRAL.md'),report.join('\n')+'\n');
process.stdout.write('Saved 4,500 results and TRES_BASES_E_CENTRAL.md.\n');
