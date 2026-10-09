export const POKEMON_TYPES = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const

export type PokemonTypeName = typeof POKEMON_TYPES[number]

export interface PokemonStats {
  hp: number
  attack: number
  defense: number
  specialAttack: number
  specialDefense: number
  speed: number
}

export type PokemonKind = 'normal' | 'gmax' | 'dynamax' | 'mega'

export interface PokemonSummary {
  id: number
  name: string
  types: PokemonTypeName[]
  imageUrl: string
  kind: PokemonKind
  baseId?: number
}

export interface PokemonBattleData extends PokemonSummary {
  speciesId: number
  moves: string[]
  stats: PokemonStats
  abilities: string[]
  height: number
  weight: number
  baseExperience: number
}

export interface Team {
  id: string
  name: string
  color: string
  pokemon: PokemonSummary[]
}

export interface BattleFighter {
  teamId: string
  teamName: string
  teamColor: string
  teamIndex: number
  pokemon: PokemonBattleData
  currentHp: number
  maxHp: number
  moves: BattleMove[]
  rng: () => number
}

export interface BattleActor {
  id: number
  name: string
  imageUrl: string
  kind: PokemonKind
  teamId: string
  teamName: string
  teamColor: string
  hp: number
  maxHp: number
  types: PokemonTypeName[]
}

export interface BattleMove {
  name: string
  type: PokemonTypeName
  power: number
  damageClass: 'physical' | 'special'
  accuracy?: number | null
}

export interface BattleEvent {
  id: string
  kind: 'duel' | 'turn' | 'miss' | 'faint' | 'result'
  title: string
  detail: string
  attacker?: BattleActor
  defender?: BattleActor
  move?: BattleMove
  damage?: number
  effectiveness?: number
  critical?: boolean
  hpBefore?: number
  hpAfter?: number
  winner?: BattleActor
}

export interface BattleResult {
  winnerTeamId: string
  winnerTeamName: string
  seed: string
  events: BattleEvent[]
  remaining: Array<{
    teamId: string
    teamName: string
    pokemonName: string
    imageUrl: string
    teamColor: string
    currentHp: number
    maxHp: number
  }>
}
