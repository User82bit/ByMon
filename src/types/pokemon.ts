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

export interface PokemonSummary {
  id: number
  name: string
  types: PokemonTypeName[]
  imageUrl: string
}

export interface PokemonBattleData extends PokemonSummary {
  stats: PokemonStats
  abilities: string[]
  height: number
  weight: number
  baseExperience: number
}

export interface Team {
  id: string
  name: string
  pokemon: PokemonSummary[]
}

export interface BattleFighter {
  teamId: string
  teamName: string
  teamIndex: number
  pokemon: PokemonBattleData
  currentHp: number
}

export interface BattleEvent {
  id: string
  kind: 'duel' | 'turn' | 'faint' | 'result'
  title: string
  detail: string
  attacker?: string
  defender?: string
  winner?: string
  winnerTeam?: string
  effectiveness?: number
  damage?: number
}

export interface BattleResult {
  winnerTeamId: string
  winnerTeamName: string
  events: BattleEvent[]
  remaining: Array<{
    teamId: string
    teamName: string
    pokemonName: string
    currentHp: number
    maxHp: number
  }>
}
