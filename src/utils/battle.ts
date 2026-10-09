import { formatEffectiveness, getTypeEffectiveness } from '../data/typeChart'
import type { BattleActor, BattleEvent, BattleFighter, BattleMove, BattleResult, PokemonBattleData, PokemonTypeName, Team } from '../types/pokemon'

export const USE_LEVEL_50_STATS = true
export const VARIANT_MULTIPLIERS = { normal: 1, mega: 1, gmax: 1.5, dynamax: 2 } as const
const LEVEL = 50
const MOVE_CACHE = new Map<string, Promise<MoveData>>()
const API_BASE = '/api/pokeapi?path='

interface MoveData {
  name: string
  power: number | null
  accuracy: number | null
  type: PokemonTypeName
  damageClass: 'physical' | 'special' | 'status'
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function seedNumber(seed: string): number {
  let value = 2166136261
  for (let i = 0; i < seed.length; i += 1) value = Math.imul(value ^ seed.charCodeAt(i), 16777619)
  return value >>> 0
}

function readStat(base: number, hp = false): number {
  if (!USE_LEVEL_50_STATS) return base
  return Math.floor((2 * base + 31) * LEVEL / 100) + (hp ? 60 : 5)
}

function fetchMove(name: string): Promise<MoveData> {
  const cached = MOVE_CACHE.get(name)
  if (cached) return cached
  const request = fetch(API_BASE + encodeURIComponent('/move/' + name))
    .then(async response => {
      if (!response.ok) throw new Error('Não foi possível carregar o golpe ' + name)
      const data = await response.json() as { name: string; power: number | null; accuracy: number | null; type: { name: string }; damage_class: { name: string } }
      return { name: data.name, power: data.power, accuracy: data.accuracy, type: data.type.name as PokemonTypeName, damageClass: data.damage_class.name as MoveData['damageClass'] }
    })
    .catch(error => { MOVE_CACHE.delete(name); throw error })
  MOVE_CACHE.set(name, request)
  return request
}

function shuffle<T>(values: T[], rng: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

async function prepareMoves(pokemon: PokemonBattleData, rng: () => number): Promise<BattleMove[]> {
  const source = pokemon.moves.length ? pokemon.moves : []
  const shuffled = shuffle(source, rng)
  const valid: BattleMove[] = []
  for (let start = 0; start < shuffled.length && valid.length < 10; start += 8) {
    const batch = await Promise.all(shuffled.slice(start, start + 8).map(async name => {
      try { return await fetchMove(name) } catch { return null }
    }))
    for (const move of batch) {
      if (move && move.power !== null && move.power > 0 && move.damageClass !== 'status') {
        valid.push({ name: move.name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' '), type: move.type, power: move.power, damageClass: move.damageClass, accuracy: move.accuracy })
        if (valid.length >= 10) break
      }
    }
  }
  if (valid.length) return valid
  return [{ name: 'Golpe básico', type: 'normal', power: 50, damageClass: 'physical' }]
}

function makeFighter(team: Team, pokemon: PokemonBattleData, teamIndex: number, rng: () => number): BattleFighter {
  const multiplier = VARIANT_MULTIPLIERS[pokemon.kind]
  const maxHp = Math.floor(readStat(pokemon.stats.hp, true) * multiplier)
  return { teamId: team.id, teamName: team.name, teamColor: team.color, teamIndex, pokemon, currentHp: maxHp, maxHp, moves: [], rng }
}

function actor(fighter: BattleFighter): BattleActor {
  return { id: fighter.pokemon.id, name: fighter.pokemon.name, imageUrl: fighter.pokemon.imageUrl, kind: fighter.pokemon.kind, teamId: fighter.teamId, teamName: fighter.teamName, teamColor: fighter.teamColor, hp: Math.max(0, fighter.currentHp), maxHp: fighter.maxHp, types: fighter.pokemon.types }
}

function firstToAct(a: BattleFighter, b: BattleFighter): BattleFighter {
  if (a.pokemon.stats.speed > b.pokemon.stats.speed) return a
  if (b.pokemon.stats.speed > a.pokemon.stats.speed) return b
  return a.teamIndex <= b.teamIndex ? a : b
}

function calculateDamage(attacker: BattleFighter, defender: BattleFighter, move: BattleMove, rng: () => number) {
  const physical = move.damageClass === 'physical'
  const attack = readStat(physical ? attacker.pokemon.stats.attack : attacker.pokemon.stats.specialAttack)
  const defense = Math.max(1, readStat(physical ? defender.pokemon.stats.defense : defender.pokemon.stats.specialDefense))
  const base = Math.floor(Math.floor(Math.floor(((2 * LEVEL / 5 + 2) * move.power * attack / defense) / 50) + 2))
  const effectiveness = getTypeEffectiveness(move.type, defender.pokemon.types)
  const critical = rng() < 1 / 16
  const random = 0.85 + rng() * 0.15
  const stab = attacker.pokemon.types.includes(move.type) ? 1.5 : 1
  const variant = VARIANT_MULTIPLIERS[attacker.pokemon.kind]
  const dealt = effectiveness === 0 ? 0 : Math.max(1, Math.floor(base * stab * effectiveness * (critical ? 1.5 : 1) * random * variant))
  return { dealt, effectiveness, critical }
}

function nextOpponent(queues: Map<string, BattleFighter[]>, order: string[], start: number): string | null {
  for (let i = 0; i < order.length; i += 1) {
    const id = order[(start + i) % order.length]
    if ((queues.get(id)?.length ?? 0) > 0) return id
  }
  return null
}

async function duel(a: BattleFighter, b: BattleFighter, events: BattleEvent[], index: number, rng: () => number): Promise<{ winner: BattleFighter; index: number }> {
  events.push({ id: 'duel-' + index, kind: 'duel', title: a.pokemon.name + ' × ' + b.pokemon.name, detail: a.teamName + ' enfrenta ' + b.teamName + '.', attacker: actor(a), defender: actor(b) })
  let current = index + 1
  let attacker = firstToAct(a, b)
  let defender = attacker === a ? b : a
  while (a.currentHp > 0 && b.currentHp > 0) {
    const move = attacker.moves[Math.floor(rng() * attacker.moves.length)] ?? { name: 'Golpe básico', type: 'normal' as const, power: 50, damageClass: 'physical' as const }
    const hpBefore = defender.currentHp
    if (move.accuracy !== undefined && move.accuracy !== null && rng() * 100 >= move.accuracy) {
      events.push({ id: 'miss-' + current, kind: 'miss', title: 'Errou!', detail: attacker.pokemon.name + ' errou ' + move.name + ' contra ' + defender.pokemon.name + '.', attacker: actor(attacker), defender: actor(defender), move, hpBefore, hpAfter: defender.currentHp, damage: 0 })
      current += 1
    } else {
      const result = calculateDamage(attacker, defender, move, rng)
      defender.currentHp = Math.max(0, defender.currentHp - result.dealt)
      const detail = result.effectiveness === 0 ? 'Não afeta ' + defender.pokemon.name + '.' : attacker.pokemon.name + ' usou ' + move.name + ' em ' + defender.pokemon.name + ' (' + formatEffectiveness(result.effectiveness) + ').'
      events.push({ id: 'turn-' + current, kind: 'turn', title: attacker.pokemon.name + ' usou ' + move.name, detail, attacker: actor(attacker), defender: actor(defender), move, damage: result.dealt, effectiveness: result.effectiveness, critical: result.critical, hpBefore, hpAfter: defender.currentHp })
      current += 1
    }
    if (defender.currentHp <= 0) {
      events.push({ id: 'faint-' + current, kind: 'faint', title: defender.pokemon.name + ' foi derrotado', detail: attacker.teamName + ' venceu este duelo.', attacker: actor(attacker), defender: actor(defender), winner: actor(attacker) })
      return { winner: attacker, index: current + 1 }
    }
    const previous = attacker
    attacker = defender
    defender = previous
  }
  return { winner: a.currentHp > 0 ? a : b, index: current }
}

export async function simulateBattle(teams: Team[], details: Map<number, PokemonBattleData>, options: { seed?: string } = {}): Promise<BattleResult> {
  const seed = options.seed ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
  const rng = mulberry32(seedNumber(seed))
  const queues = new Map<string, BattleFighter[]>()
  for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
    const team = teams[teamIndex]
    const fighters = (team.pokemon.map(pokemon => {
      const data = details.get(pokemon.id)
      if (!data) throw new Error('Dados de ' + pokemon.name + ' não foram encontrados.')
      return makeFighter(team, data, teamIndex, rng)
    }))
    for (const fighter of fighters) fighter.moves = await prepareMoves(fighter.pokemon, rng)
    queues.set(team.id, fighters)
  }
  const events: BattleEvent[] = []
  let index = 0
  let champion = queues.get(teams[0]?.id ?? '')?.shift() ?? null
  let alive = new Set(teams.map(team => team.id))
  while (champion && alive.size > 1) {
    const order = teams.map(team => team.id).filter(teamId => alive.has(teamId))
    const championIndex = Math.max(0, order.indexOf(champion.teamId))
    const opponentId = nextOpponent(queues, order, (championIndex + 1) % order.length)
    if (!opponentId) break
    const opponent = queues.get(opponentId)?.shift()
    if (!opponent) { alive.delete(opponentId); continue }
    const result = await duel(champion, opponent, events, index, rng)
    champion = result.winner
    index = result.index
    alive = new Set(teams.filter(team => team.id === champion?.teamId || (queues.get(team.id)?.length ?? 0) > 0).map(team => team.id))
  }
  if (!champion) throw new Error('A batalha terminou sem um vencedor.')
  const winnerTeam = teams.find(team => team.id === champion?.teamId) ?? teams[0]
  events.push({ id: 'result-' + index, kind: 'result', title: 'Fim da batalha', detail: champion.pokemon.name + ' ficou como último Pokémon ativo.', winner: actor(champion) })
  const remaining = teams.flatMap(team => {
    const queued = queues.get(team.id) ?? []
    const active = champion && champion.teamId === team.id ? [champion] : []
    return active.concat(queued).map(entry => ({ teamId: team.id, teamName: team.name, pokemonName: entry.pokemon.name, imageUrl: entry.pokemon.imageUrl, teamColor: team.color, currentHp: Math.max(0, entry.currentHp), maxHp: entry.maxHp }))
  })
  return { seed, winnerTeamId: winnerTeam.id, winnerTeamName: winnerTeam.name, events, remaining }
}
