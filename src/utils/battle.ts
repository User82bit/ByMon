import { formatEffectiveness, getTypeEffectiveness } from '../data/typeChart'
import type { BattleEvent, BattleFighter, BattleResult, PokemonBattleData, PokemonTypeName, Team } from '../types/pokemon'

const LEVEL = 50
const MOVE_POWER = 60

function fighter(team: Team, pokemon: PokemonBattleData, teamIndex: number): BattleFighter {
  return { teamId: team.id, teamName: team.name, teamIndex, pokemon, currentHp: pokemon.stats.hp }
}

function selectMoveType(attacker: PokemonBattleData, defender: PokemonBattleData): { type: PokemonTypeName; effectiveness: number } {
  const selected = attacker.types
    .map((type) => ({ type, effectiveness: getTypeEffectiveness(type, defender.types) }))
    .sort((a, b) => b.effectiveness - a.effectiveness)[0]
  return selected ?? { type: attacker.types[0], effectiveness: 1 }
}

function damage(attacker: PokemonBattleData, defender: PokemonBattleData, moveType: PokemonTypeName, effectiveness: number): number {
  const offensive = Math.max(attacker.stats.attack, attacker.stats.specialAttack)
  const defensive = Math.max(defender.stats.defense, defender.stats.specialDefense)
  const critical = Math.random() < 0.0625 ? 1.5 : 1
  const random = 0.85 + Math.random() * 0.15
  const stab = attacker.types.includes(moveType) ? 1.5 : 1
  const base = Math.floor(Math.floor(Math.floor(((2 * LEVEL) / 5 + 2) * MOVE_POWER * offensive / defensive) / 50) + 2)
  return Math.max(1, Math.floor(base * critical * random * stab * effectiveness))
}

function firstToAct(a: BattleFighter, b: BattleFighter): BattleFighter {
  if (a.pokemon.stats.speed > b.pokemon.stats.speed) return a
  if (b.pokemon.stats.speed > a.pokemon.stats.speed) return b
  return a.teamIndex <= b.teamIndex ? a : b
}

function nextOpponent(queues: Map<string, BattleFighter[]>, order: string[], start: number): string | null {
  for (let i = 0; i < order.length; i += 1) {
    const id = order[(start + i) % order.length]
    if ((queues.get(id)?.length ?? 0) > 0) return id
  }
  return null
}

function duel(a: BattleFighter, b: BattleFighter, events: BattleEvent[], index: number): { winner: BattleFighter; index: number } {
  events.push({
    id: 'duel-' + index,
    kind: 'duel',
    title: a.pokemon.name + ' × ' + b.pokemon.name,
    detail: a.teamName + ' enfrenta ' + b.teamName + '.',
  })
  let current = index + 1
  let attacker = firstToAct(a, b)
  let defender = attacker === a ? b : a

  while (a.currentHp > 0 && b.currentHp > 0) {
    const selected = selectMoveType(attacker.pokemon, defender.pokemon)
    const dealt = damage(attacker.pokemon, defender.pokemon, selected.type, selected.effectiveness)
    defender.currentHp = Math.max(0, defender.currentHp - dealt)

    events.push({
      id: 'turn-' + current,
      kind: 'turn',
      title: attacker.pokemon.name + ' atacou',
      detail:
        attacker.pokemon.name + ' causou ' + dealt + ' de dano em ' + defender.pokemon.name +
        ' usando tipo ' + selected.type + ' (' + formatEffectiveness(selected.effectiveness) + ').',
      attacker: attacker.pokemon.name,
      defender: defender.pokemon.name,
      effectiveness: selected.effectiveness,
      damage: dealt,
    })
    current += 1

    if (defender.currentHp <= 0) {
      events.push({
        id: 'faint-' + current,
        kind: 'faint',
        title: defender.pokemon.name + ' foi derrotado',
        detail: attacker.pokemon.name + ' venceu o duelo.',
        winner: attacker.pokemon.name,
        winnerTeam: attacker.teamName,
      })
      return { winner: attacker, index: current + 1 }
    }

    const previous = attacker
    attacker = defender
    defender = previous
  }

  return { winner: a.currentHp > 0 ? a : b, index: current }
}

export function simulateBattle(teams: Team[], details: Map<number, PokemonBattleData>): BattleResult {
  const queues = new Map<string, BattleFighter[]>()

  teams.forEach((team, teamIndex) => {
    queues.set(team.id, team.pokemon.map((pokemon) => {
      const data = details.get(pokemon.id)
      if (!data) throw new Error('Dados de ' + pokemon.name + ' não foram encontrados.')
      return fighter(team, data, teamIndex)
    }))
  })

  const events: BattleEvent[] = []
  let index = 0
  let champion = queues.get(teams[0].id)?.shift() ?? null
  let alive = new Set(teams.map((team) => team.id))

  while (champion && alive.size > 1) {
    const order = teams
      .map((team) => team.id)
      .filter((teamId) => alive.has(teamId))
    const championIndex = Math.max(0, order.indexOf(champion.teamId))
    const opponentId = nextOpponent(queues, order, (championIndex + 1) % order.length)

    if (!opponentId) break
    const opponent = queues.get(opponentId)?.shift()

    if (!opponent) {
      alive.delete(opponentId)
      continue
    }

    const result = duel(champion, opponent, events, index)
    champion = result.winner
    index = result.index

    if (opponent.currentHp <= 0 && (queues.get(opponent.teamId)?.length ?? 0) === 0) {
      alive.delete(opponent.teamId)
    }

    alive = new Set(
      teams
        .filter((team) => team.id === champion?.teamId || (queues.get(team.id)?.length ?? 0) > 0)
        .map((team) => team.id),
    )
  }

  const winner = champion ?? queues.get(teams[0].id)?.[0]
  if (!winner) throw new Error('A batalha terminou sem um vencedor.')

  const winnerTeam = teams.find((team) => team.id === winner.teamId) ?? teams[0]

  events.push({
    id: 'result-' + index,
    kind: 'result',
    title: 'Fim da batalha',
    detail: winner.pokemon.name + ' ficou como último Pokémon ativo.',
    winner: winner.pokemon.name,
    winnerTeam: winnerTeam.name,
  })

  const remaining = teams.flatMap((team) => {
    const queued = queues.get(team.id) ?? []
    const active = champion && champion.teamId === team.id ? [champion] : []
    return active.concat(queued).map((entry) => ({
      teamId: team.id,
      teamName: team.name,
      pokemonName: entry.pokemon.name,
      currentHp: Math.max(0, entry.currentHp),
      maxHp: entry.pokemon.stats.hp,
    }))
  })

  return {
    winnerTeamId: winnerTeam.id,
    winnerTeamName: winnerTeam.name,
    events,
    remaining,
  }
}
