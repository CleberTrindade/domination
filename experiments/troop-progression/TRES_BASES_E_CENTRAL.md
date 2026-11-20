# Domination — três bases estabelecidas mais o bombardeiro central

Simulação solicitada por Cleber em 20/11/2026 para testar uma defesa offline com três bases mais o bombardeiro central, preservando as forças por tropa usadas no estudo anterior.

## Configuração testada

- A defesa começa com **quatro posições no total**: quartel inicial, duas bases mais próximas dele e o bombardeiro central. A seleção foi definida pela distância antes de medir vitórias: IDs 1, 7, 5 e 0, respectivamente. São duas garagens, uma base de botes e o bombardeiro; não foi escolhido um arranjo depois de observar o resultado.
- O atacante mantém uma base e 38 tropas iniciais. Cada base mantida da defesa conserva sua quantidade original de tropas. Bases retiradas da defesa voltam a ser neutras, com a guarnição neutra padrão, e podem ser conquistadas por qualquer lado.
- A defesa ocupa **23,5% dos hexágonos** nesse arranjo. Não se mantêm os 50% de território do teste anterior: o mapa associa hexágonos às bases, portanto a mudança no número de bases também altera a ocupação.
- Produção, capacidades, velocidades, intervalo de decisões da CPU, paraquedas e duração máxima de seis minutos continuam iguais aos testes anteriores. A CPU fica ativa e mantém o bombardeiro no início; capturá-lo não encerra a batalha.
- São usados os níveis 1, 5 e 10 do mesmo protótipo de evolução: poder `1 + 0,10 × (nível − 1)`. Cada lado mantém integralmente seu próprio nível; não se aplica redução percentual extra à defesa. O nível 1 corresponde à força atual sem upgrades. Níveis 5 e 10 representam a evolução proposta, ainda não publicada.
- Bases neutras acompanham a referência de força do atacante, conforme o estudo anterior. O proprietário não assume a defesa e não há invasores adicionais.

Foram 4.500 combates: nove combinações de níveis × cinco perfis de área × duas estratégias de ataque × 50 sementes de 3001 a 3050. As sementes e estratégias são as mesmas da análise anterior com nove bases, permitindo comparação emparelhada. Cada célula da tabela principal representa 500 batalhas.

## Tropas e ocupação iniciais

| Área | Defesa anterior: nove posições | Nova defesa: três bases + central | Atacante |
| --- | ---: | ---: | ---: |
| Litoral Sul | 111 | 56 | 38 |
| Agreste | 120 | 60 | 38 |
| Alto Sertão | 129 | 64 | 38 |
| São Francisco | 138 | 68 | 38 |
| Capital | 147 | 72 | 38 |

## Vitórias do atacante

| Nível do atacante | Dono nível 1 | Dono nível 5 | Dono nível 10 |
| --- | ---: | ---: | ---: |
| 1 | 84,6% | 32,6% | 4,2% |
| 5 | 100,0% | 81,8% | 30,0% |
| 10 | 100,0% | 99,0% | 73,8% |

## Comparação entre níveis iguais

| Nível de ambos | Nove posições anteriores | Três bases + central |
| --- | ---: | ---: |
| 1 | 17,6% | 84,6% |
| 5 | 16,8% | 81,8% |
| 10 | 16,0% | 73,8% |

## Resultados por área entre níveis iguais

Cada célula representa 100 combates, somando as duas estratégias. Este recorte evita esconder diferenças regionais na média.

| Área | Ambos nível 1 | Ambos nível 5 | Ambos nível 10 |
| --- | ---: | ---: | ---: |
| Litoral Sul | 100,0% | 100,0% | 100,0% |
| Agreste | 100,0% | 98,0% | 94,0% |
| Alto Sertão | 96,0% | 95,0% | 92,0% |
| São Francisco | 84,0% | 75,0% | 67,0% |
| Capital | 43,0% | 41,0% | 16,0% |

## Leitura em relação à meta

A redução de nove posições para três bases mais o bombardeiro aproxima a média entre níveis iguais da faixa geral desejada de 60%–83%. Os níveis 5 e 10 ficam dentro dessa faixa; o nível 1 fica 1,6 ponto percentual acima. Isso não significa que todos os setores já estejam equilibrados: o Litoral Sul permanece em 100% de vitórias dos bots e a Capital varia de 16% a 43%.

É uma configuração inicial mais promissora para a média, preservando o nível do dono, mas ainda pede ajuste regional de guarnição, produção e decisões. A escolha das quatro posições também deve ser mantida explícita. A faixa mais restrita de 60%–69% para defesa offline, sugerida anteriormente como possibilidade, não foi atingida nas médias dos três níveis iguais.

## Limites da conclusão

Os números são frequências de vitórias de dois bots neste protótipo, não uma previsão garantida para jogadores humanos. Reduzir a defesa também muda a localização das posições próprias, a produção total inicial, a ocupação territorial e quais armas neutras passam a atingir cada lado. O resultado é do pacote de três bases mais central, não de uma alteração isolada na força por tropa.

Outras escolhas das três bases podem produzir resultados diferentes. A comparação também não cobre o dono voltando para comandar, outros invasores entrando, reconexões ou o impacto econômico de várias batalhas. Não houve alteração no aplicativo publicado nem em dados de jogadores.

## Reprodução

```sh
# Opcional: refazer a referência anterior para preencher a comparação.
node experiments/troop-progression/offline-defense.js
node experiments/troop-progression/three-bases-defense.js
```
