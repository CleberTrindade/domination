# Domination — revisão da meta de vitórias: 60% a 83%

Meta informada por Cleber em 20/11/2026: conquistar uma área deve ser possível, com resistência, buscando de 60% a 83% de vitórias do atacante. Esta meta atualiza a recomendação exploratória do primeiro estudo. Trata-se de análise e protótipo; não altera o jogo publicado.

## Resultado geral dos testes adicionais

Foram 4.500 combates de calibração: CPU em 75%, 80% e 85% da força do atacante, níveis 1, 5 e 10, cinco áreas, duas estratégias e 50 sementes de 1001 a 1050 por combinação. O modelo mantém as bases neutras acompanhando o nível do jogador, preservando sua resistência, e aplica o desconto à guarnição territorial da CPU. Permanecem a ocupação inicial de aproximadamente 32%–40%, o bombardeiro da defesa e o limite de seis minutos.

Cada célula tem 500 partidas e soma todos os setores e as duas estratégias. Estes percentuais são vitórias dos bots do estudo, não taxas observadas de jogadores humanos.

| Força da CPU / atacante | Nível 1 | Nível 5 | Nível 10 |
| --- | ---: | ---: | ---: |
| 75% | 76,6% | 78,6% | 79,2% |
| 80% | 70,8% | 73,2% | 72,4% |
| 85% | 68,2% | 71,2% | 64,6% |

80% foi escolhido para uma segunda amostra por ficar perto de 72% de vitórias globais, com margem em relação aos dois limites. A validação usou 3.000 novas partidas, sementes independentes de 2001 a 2100 e nenhuma alteração nas estratégias: 1.000 partidas por nível.

| Configuração em validação | Nível 1 | Nível 5 | Nível 10 |
| --- | ---: | ---: | ---: |
| CPU 80% | 72,4% | 73,5% | 70,7% |

## A média global não basta

Mesmo com a média na meta, um fator único não cumpre a meta em cada área. Esta tabela usa somente a amostra independente de validação, CPU em 80%, com 200 combates por célula:

| Área | Nível 1 | Nível 5 | Nível 10 |
| --- | ---: | ---: | ---: |
| Litoral Sul | 94,5% | 98,0% | 96,0% |
| Agreste | 98,0% | 99,0% | 99,0% |
| Alto Sertão | 98,0% | 97,5% | 93,0% |
| São Francisco | 42,5% | 43,0% | 39,0% |
| Capital | 29,0% | 30,0% | 26,5% |

Assim, 80% é uma referência útil para a média geral, mas não é recomendação de aplicar o mesmo valor a todos os setores. A ocupação, a localização das bases e das armas, a produção e os caminhos criam vantagens diferentes. Alguns setores ficam fáceis demais e outros ficam abaixo do piso desejado.

## Recomendação de balanceamento

- Definir a faixa de 60%–83% como meta por setor e faixa de evolução, além da média geral.
- Usar aproximadamente 72%–75% como alvo central; reservar 78%–83% para setores introdutórios, 70%–77% para intermediários e 60%–69% para os mais difíceis.
- Calibrar a guarnição por setor, ajustando seu fator de força, quantidade inicial e produção. O valor final precisa ser simulado e validado novamente; este estudo não entrega uma configuração regional completa já dentro da faixa.
- Na calibragem, comparar duas estratégias e validar os parâmetros escolhidos em sementes que não participaram da escolha.
- Depois, medir partidas humanas contra CPU separadamente de PvP e de batalhas com invasores. Contar vitórias e derrotas válidas, incluindo desistências, e excluir interrupções do servidor. Comparar iniciantes e jogadores experientes para interpretar corretamente a média.
- Fixar os parâmetros antes de começar a batalha e mantê-los até o encerramento. A meta de vitórias serve para ajustar o balanceamento entre versões, sem alterar forças no meio de uma disputa para provocar um resultado.

Os percentuais são frequências de simulação, com variação por semente e estratégia, e não garantias para cada jogador ou para a versão final. Os resultados anteriores de CPU em 60%–65% eram geralmente fáceis demais em média para a nova meta, embora possam continuar necessários em setores com maior vantagem territorial.

## Reprodução

```sh
node experiments/troop-progression/simulate.js --seeds=50 --start=1001 --ratios=0.75,0.8,0.85 --neutrals=attacker --output=target-60-83-calibration
node experiments/troop-progression/simulate.js --seeds=100 --start=2001 --ratios=0.8 --neutrals=attacker --output=target-60-83-validation
node experiments/troop-progression/target-study.js
```
