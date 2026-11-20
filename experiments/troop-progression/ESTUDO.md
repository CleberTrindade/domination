# Domination — evolução de tropas e equilíbrio de áreas da CPU

Estudo de 20/11/2026, usando como referência o motor publicado no commit `5d2d06b`. Proposta e protótipos de simulação; as regras do aplicativo permanecem as publicadas antes deste estudo.

## Proposta de evolução

Começar com um nível geral de treinamento do exército, do 1 ao 10. O poder por tropa cresce 10 pontos percentuais do valor inicial por nível: `P(n) = 1 + 0,10 × (n − 1)`. É crescimento linear: no nível 10, 1,9 vezes a força inicial. Produção, velocidade, capacidade das bases e quantidade inicial de soldados permanecem iguais neste estudo. Especializações de tanques, helicópteros e botes podem ser estudadas depois; os resultados abaixo não representam um exército com níveis diferentes por tipo.

Custo para alcançar o nível `n ≥ 2`: `50 × teto(300 × 1,6^(n − 2) / 50)` moedas. O primeiro upgrade custa o mesmo que a recompensa de primeira conquista da CPU. Estes custos são uma proposta; a simulação mede combate e não valida a economia de longo prazo.

| Nível alcançado | Poder por tropa | Custo deste upgrade | Custo acumulado |
| --- | ---: | ---: | ---: |
| 1 | 100% | 0 | 0 |
| 2 | 110% | 300 | 300 |
| 3 | 120% | 500 | 800 |
| 4 | 130% | 800 | 1.600 |
| 5 | 140% | 1.250 | 2.850 |
| 6 | 150% | 2.000 | 4.850 |
| 7 | 160% | 3.150 | 8.000 |
| 8 | 170% | 5.050 | 13.050 |
| 9 | 180% | 8.100 | 21.150 |
| 10 | 190% | 12.900 | 34.050 |

Comprar somente com moedas disponíveis, preservando reservas. A melhoria passa a valer na próxima batalha. Níveis de participantes e guarnição são fixados na entrada e fazem parte da configuração validada do combate, preservando a simulação no navegador e a gravação financeira no encerramento.

## Força da CPU e vantagem territorial

Usar porcentagem de força real, e não porcentagem do número do nível: `P_CPU = P_atacante × fator`. Exemplo: jogador de nível 10 tem poder 190; a CPU com 65% fica em 123,5 pontos e com 70% em 133. Nível 7 teria poder 160, portanto não equivale a 70% do nível 10.

O fator reduzido é exclusivo de áreas sem dono humano. Áreas conquistadas mantêm a evolução real do proprietário, inclusive quando a CPU controla sua defesa. O nível da guarnição não muda durante a disputa. Invasores posteriores de outros níveis, faixas de entrada e exércitos mistos exigem um estudo separado: as simulações abaixo são atacante contra CPU.

Estado inicial real dos cinco setores:

| Área | Ocupação aproximada | Bases da CPU | Tropas da CPU | Tropas do atacante | Produção por base da CPU / jogador |
| --- | ---: | ---: | ---: | ---: | ---: |
| Litoral Sul | 32,1% | 6 | 78 | 38 | 57,9% |
| Agreste | 34,6% | 5 | 72 | 38 | 61,7% |
| Alto Sertão | 34,6% | 5 | 77 | 38 | 65,4% |
| São Francisco | 37,0% | 7 | 110 | 38 | 69,2% |
| Capital | 39,5% | 6 | 102 | 38 | 72,9% |

Percentual de hexágonos não equivale ao percentual de bases produtoras. O bombardeiro central continua sendo da defesa no início; sua captura é uma vantagem e não encerra a batalha.

## Como o estudo foi executado

Foram 18.000 combates na amostra principal: 3 tratamentos das bases neutras × 3 níveis (1, 5 e 10) × 4 fatores de poder da CPU (60%, 65%, 70%, 100%) × 5 áreas × 2 estratégias de ataque × 50 sementes, de 1001 a 1050. Pilotos com sementes de 1 a 8 ficam fora dessas contagens. As estratégias foram definidas antes da amostra principal e não foram ajustadas aos seus resultados.

- Expansão simples: uma origem por ataque, decisão a cada 3 segundos, escolha de alvo próximo com forças suficientes e uso do paraquedas disponível.
- Ataque coordenado: combina até quatro origens, reforça bases ameaçadas, considera produção e tropas em trânsito, decide a cada 1,5 segundo e usa o paraquedas disponível.
- A CPU continua ativa, com produção, capacidade, intervalo de decisões, aleatoriedade e tropas iniciais originais. Sua estimativa de tropas necessárias considera o novo poder de combate. Não foi congelada nem comandada pelo atacante.
- O protótipo modifica uma cópia do motor carregada em memória. O multiplicador afeta dano dos grupos e armas e a resolução da captura. Dano é multiplicado uma vez pela força de quem atira; não se reduz ao mesmo tempo pela força da vítima, o que aplicaria a vantagem duas vezes.
- O limite é de 360 segundos de combate, com os 3 segundos de contagem inicial originais. Vitória exige eliminar as bases e tropas móveis da CPU. Tempo esgotado é derrota.
- Como controle, a cópia experimental reproduziu exatamente os snapshots serializados do motor original, com poder 1 para ambos, em cinco comparações de 2.100 passos cada.

## Resultados agregados

Cada célula abaixo resume 500 batalhas: cinco áreas, duas estratégias e 50 sementes. São frequências dos bots neste protótipo, não probabilidades de vitória de jogadores humanos.

### Bases neutras com força fixa

| Poder da CPU / atacante | Nível 1 | Nível 5 | Nível 10 |
| --- | ---: | ---: | ---: |
| 60% | 97,8% | 100,0% | 100,0% |
| 65% | 91,6% | 99,4% | 100,0% |
| 70% | 81,2% | 98,4% | 99,8% |
| 100% | 47,4% | 72,4% | 70,8% |

### Bases neutras na mesma força reduzida da CPU

| Poder da CPU / atacante | Nível 1 | Nível 5 | Nível 10 |
| --- | ---: | ---: | ---: |
| 60% | 100,0% | 99,8% | 100,0% |
| 65% | 100,0% | 99,8% | 100,0% |
| 70% | 99,0% | 99,2% | 98,4% |
| 100% | 47,4% | 50,0% | 43,8% |

### Bases neutras acompanham a força do jogador

| Poder da CPU / atacante | Nível 1 | Nível 5 | Nível 10 |
| --- | ---: | ---: | ---: |
| 60% | 97,8% | 98,4% | 97,8% |
| 65% | 91,6% | 92,4% | 93,6% |
| 70% | 81,2% | 85,0% | 83,2% |
| 100% | 47,4% | 50,0% | 43,8% |

### Recorte por área: bases neutras acompanhando o nível do jogador

Para não desatualizar as bases independentes nem reduzir sua resistência inicial, esta alternativa mantém sua força proporcional ao nível do jogador, sem aplicar nelas o desconto da guarnição territorial. A tabela usa nível 1; cada célula tem 100 batalhas, somando as duas estratégias. No nível 1, este modelo coincide com as bases neutras fixas.

| Área | CPU 60% | CPU 65% | CPU 70% | CPU 100% |
| --- | ---: | ---: | ---: | ---: |
| Litoral Sul | 100,0% | 100,0% | 100,0% | 67,0% |
| Agreste | 100,0% | 100,0% | 100,0% | 94,0% |
| Alto Sertão | 100,0% | 100,0% | 100,0% | 68,0% |
| São Francisco | 92,0% | 76,0% | 53,0% | 7,0% |
| Capital | 97,0% | 82,0% | 53,0% | 1,0% |

## Interpretação e recomendação

É possível conquistar as cinco áreas com a CPU em 60%–70% nos cenários estudados. A vantagem inicial de território e do bombardeiro não torna a conquista impossível. No nível 1, 70% ofereceu resistência nos dois setores finais: 53 vitórias em 100 para São Francisco e 53 em 100 para Capital, somando os dois bots. Portanto, 70% não é automaticamente fácil em todos os mapas.

A adaptação das bases neutras muda muito o resultado: deixá-las fixas facilita os níveis altos; aplicar o desconto de 60%–70% também a elas gerou de 98,4% a 100% de vitórias nas combinações testadas. Esse segundo desenho parece fácil demais para os bots usados, apesar de cumprir o requisito de serem áreas conquistáveis.

Recomendação inicial: 60% para introdução/tutorial, 65% para dificuldade intermediária e 70% para setores finais. Preferir que bases neutras acompanhem a evolução sem receber automaticamente o mesmo desconto da guarnição territorial. Usar o fator por setor e validar com partidas humanas: a simples porcentagem não representa sozinha dificuldade, porque a composição das bases, trajetos, produção, torres e tempo de reação também contam.

Os testes não validam PvP, participantes que entram depois, especializações com níveis diferentes, gasto real de moedas ao longo de semanas, nem efeitos de latência humana. A curva de custos é uma proposta separada desses resultados de combate.

## Reprodução

```sh
node experiments/troop-progression/simulate.js --seeds=50 --start=1001 --output=results
node experiments/troop-progression/simulate.js --seeds=50 --start=1001 --neutrals=scaled --output=scaled-neutrals
node experiments/troop-progression/simulate.js --seeds=50 --start=1001 --neutrals=attacker --output=player-neutrals
node experiments/troop-progression/summarize.js
```

O CSV `summary.csv` registra 360 cenários agregados, com vitórias, derrotas, encerramentos por tempo e mediana da duração das vitórias. Arquivos por batalha são gerados localmente pelos comandos acima. Nenhum comando usa banco, conta de jogador ou serviço de publicação.
