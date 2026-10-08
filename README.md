# [ByMon](https://by-mon.vercel.app)

Simulador web de batalhas entre times de Pokémon.

## Mecânica

- Começa com **Time A** e **Time B**, com nomes editáveis.
- Permite adicionar mais times.
- Cada time aceita de 1 a 6 Pokémon.
- O mesmo Pokémon pode existir em times diferentes, mas não pode se repetir dentro do mesmo time.
- A seleção usa a PokéAPI para nome, tipos e artes oficiais.
- A Pokédex possui filtro por tipo e pesquisa por nome.
- Pokémon podem ser arrastados para os times.
- Ao iniciar a batalha, os dados completos são carregados da PokéAPI.
- A simulação usa HP, Attack, Defense, Special Attack, Special Defense e Speed, além de STAB e efetividade dos tipos.
- Speed decide quem ataca primeiro; em empate, o time que aparece primeiro vence a prioridade.
- O Pokémon vencedor de um duelo continua ativo e enfrenta o próximo Pokémon das outras equipes, até restar apenas uma equipe.
- A tela de batalha mostra os atributos coletados, os confrontos, os turnos e o resultado.
- O botão **Retornar** reinicia a configuração para os dois times primários.

## Organização

- `pages/`: telas Home e Battle.
- `components/`: componentes reutilizáveis.
- `layout/`: estrutura geral.
- `components/ui/`: elementos básicos de interface.
- `services/`: comunicação com a PokéAPI.
- `data/typeChart.ts`: matriz de forças, fraquezas e imunidades.
- `types/`: modelos TypeScript.
- `utils/`: regras de batalha e formatação.

Fonte: https://pokeapi.co/docs/v2
