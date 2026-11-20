# Domination — evolução do proprietário e defesa offline

Estudo de 20/11/2026. Pergunta: ao manter a evolução do dono enquanto a CPU defende sua área offline, qual seria a taxa de vitórias do atacante?

## Método

Foram 4.500 combates experimentais, com atacante nos níveis 1, 5 e 10 e proprietário nos mesmos três níveis: nove pares × cinco perfis de área × duas estratégias de ataque × 50 sementes de 3001 a 3050. Cada célula da tabela principal tem 500 batalhas.

A defesa começa com aproximadamente 50% dos hexágonos e o bombardeiro central, conforme a configuração atual de áreas ocupadas. Mantêm-se as tropas iniciais, produção e intervalos de decisão originais de cada setor. A CPU permanece ativa. Vitória exige eliminar bases e tropas, no limite de seis minutos. Não há entrada de invasores ou retorno do dono para assumir a defesa.

O poder proposto do nível n é `1 + 0,10 × (n − 1)`. O atacante usa seu poder e a defesa usa o poder integral do proprietário, sem receber o desconto de 60%–85% usado nos testes de guarnições sem dono. As bases neutras acompanham a força de referência do atacante, como no modelo anterior. A inteligência e a produção mantêm os perfis atuais; não foram calibradas para o alvo de vitórias.

A evolução ainda é um protótipo carregado em uma cópia do motor em memória. Estes dados não são taxas observadas de partidas humanas nem representam um balanceamento final publicado.

## Vitórias do atacante

| Nível do atacante | Dono nível 1 | Dono nível 5 | Dono nível 10 |
| --- | ---: | ---: | ---: |
| 1 | 17,6% | 1,6% | 0,0% |
| 5 | 50,2% | 16,8% | 1,2% |
| 10 | 92,2% | 47,2% | 16,0% |

## Confrontos de mesmo nível por área

Cada célula contém 100 combates, somando as duas estratégias e as 50 sementes.

| Área | Ambos nível 1 | Ambos nível 5 | Ambos nível 10 |
| --- | ---: | ---: | ---: |
| Litoral Sul | 38,0% | 40,0% | 39,0% |
| Agreste | 28,0% | 25,0% | 27,0% |
| Alto Sertão | 19,0% | 15,0% | 12,0% |
| São Francisco | 2,0% | 3,0% | 2,0% |
| Capital | 1,0% | 1,0% | 0,0% |

## Condições iniciais da defesa ocupada

| Área | Bases da defesa | Tropas da defesa | Tropas do atacante |
| --- | ---: | ---: | ---: |
| Litoral Sul | 9 | 111 | 38 |
| Agreste | 9 | 120 | 38 |
| Alto Sertão | 9 | 129 | 38 |
| São Francisco | 9 | 138 | 38 |
| Capital | 9 | 147 | 38 |

## Como interpretar

Não existe uma taxa única de vitória associada a "dono offline". A vantagem territorial e as evoluções dos dois lados alteram o confronto. Manter o nível do dono preserva seu investimento, mas não garante que a atual configuração de tropas, produção e ocupação esteja equilibrada.

A faixa de 60%–83% pode orientar o balanceamento das guarnições de áreas sem dono. Para defesa offline de jogadores, qualquer meta deve especificar confronto de níveis equivalentes e calibrar as vantagens iniciais e a inteligência da defesa. Aplicar a mesma faixa a qualquer diferença de evolução exigiria compensar níveis desiguais e reduzir o efeito estratégico da evolução.

Proposta ainda não calibrada: tratar a defesa offline de um proprietário de força semelhante como confronto difícil, buscando 60%–69% de vitórias do atacante. Essa faixa é um objetivo de design, não o resultado medido acima. Diante de um dono mais evoluído, a taxa pode ser menor; diante de um dono menos evoluído, pode ser maior. Ajustar a vantagem territorial inicial e as decisões da CPU preservando o poder real das tropas do dono.

Dificuldade e recompensa de áreas da CPU podem ter faixas distintas, acessíveis livremente no mundo aberto. Para uma área de jogador, dificuldade depende também da evolução do dono; a recompensa já inclui o saque limitado pela reserva dos participantes e a posse da área. Bônus de primeira conquista da CPU e saque de jogadores são regras diferentes.

O resultado acima é diagnóstico. Não configura uma meta de 60%–83% já atingida para defesas offline e não justifica enfraquecer automaticamente as tropas compradas pelo proprietário. Antes de implementar, é necessário escolher uma meta para níveis equivalentes e calibrar defesa inicial, produção e decisões sem alterar forças durante a batalha.

## Reprodução

```sh
node experiments/troop-progression/offline-defense.js
```
