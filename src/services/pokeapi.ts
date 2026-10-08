import { POKEMON_TYPES, type PokemonBattleData, type PokemonSummary, type PokemonTypeName } from '../types/pokemon'

const API_BASE = 'https://pokeapi.co/api/v2'
const OFFICIAL_ARTWORK_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork'

interface NamedResource { name: string; url: string }
interface TypeResponse { pokemon: Array<{ pokemon: NamedResource }> }
interface PokemonResponse {
  id: number
  name: string
  height: number
  weight: number
  base_experience: number
  types: Array<{ slot: number; type: NamedResource }>
  abilities: Array<{ ability: NamedResource; is_hidden: boolean }>
  stats: Array<{ base_stat: number; stat: NamedResource }>
  sprites: { other?: { 'official-artwork'?: { front_default: string | null } } }
}

let catalogPromise: Promise<PokemonSummary[]> | null = null
const battleCache = new Map<number, Promise<PokemonBattleData>>()

function parseId(url: string): number {
  const match = url.match(/\/(\d+)\/?$/)
  return match ? Number(match[1]) : 0
}

function artworkUrl(id: number): string {
  return OFFICIAL_ARTWORK_BASE + '/' + id + '.png'
}

async function getTypeMembers(type: PokemonTypeName): Promise<Array<{ id: number; name: string }>> {
  const response = await fetch(API_BASE + '/type/' + type)
  if (!response.ok) throw new Error('Falha ao carregar o tipo ' + type + '.')
  const data = (await response.json()) as TypeResponse
  return data.pokemon
    .map(({ pokemon }) => ({ id: parseId(pokemon.url), name: pokemon.name }))
    .filter((pokemon) => pokemon.id > 0)
}

async function loadCatalog(): Promise<PokemonSummary[]> {
  const memberships = await Promise.all(
    POKEMON_TYPES.map(async (type) => ({ type, pokemon: await getTypeMembers(type) })),
  )
  const byName = new Map<string, PokemonSummary>()

  for (const membership of memberships) {
    for (const entry of membership.pokemon) {
      const existing = byName.get(entry.name)
      if (existing) {
        if (!existing.types.includes(membership.type)) existing.types.push(membership.type)
        continue
      }
      byName.set(entry.name, {
        id: entry.id,
        name: entry.name,
        types: [membership.type],
        imageUrl: artworkUrl(entry.id),
      })
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.id - b.id)
}

export async function getPokemonCatalog(): Promise<PokemonSummary[]> {
  if (!catalogPromise) {
    catalogPromise = loadCatalog().catch((error) => {
      catalogPromise = null
      throw error
    })
  }
  return catalogPromise
}

export async function getPokemonBattleData(pokemon: PokemonSummary): Promise<PokemonBattleData> {
  const cached = battleCache.get(pokemon.id)
  if (cached) return cached

  const request = fetch(API_BASE + '/pokemon/' + pokemon.id)
    .then(async (response) => {
      if (!response.ok) throw new Error('Falha ao carregar os dados de ' + pokemon.name + '.')
      return (await response.json()) as PokemonResponse
    })
    .then((data) => {
      const findStat = (name: string) =>
        data.stats.find((stat) => stat.stat.name === name)?.base_stat ?? 1

      return {
        id: data.id,
        name: data.name,
        types: data.types
          .sort((a, b) => a.slot - b.slot)
          .map((entry) => entry.type.name as PokemonTypeName),
        imageUrl: data.sprites.other?.['official-artwork']?.front_default ?? artworkUrl(data.id),
        stats: {
          hp: findStat('hp'),
          attack: findStat('attack'),
          defense: findStat('defense'),
          specialAttack: findStat('special-attack'),
          specialDefense: findStat('special-defense'),
          speed: findStat('speed'),
        },
        abilities: data.abilities.map(({ ability, is_hidden }) =>
          is_hidden ? ability.name + ' (oculta)' : ability.name,
        ),
        height: data.height,
        weight: data.weight,
        baseExperience: data.base_experience ?? 0,
      }
    })
    .catch((error) => {
      battleCache.delete(pokemon.id)
      throw error
    })

  battleCache.set(pokemon.id, request)
  return request
}
