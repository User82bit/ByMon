import { POKEMON_TYPES, type PokemonBattleData, type PokemonSummary, type PokemonTypeName } from '../types/pokemon'

const API_BASE = 'https://pokeapi.co/api/v2'
const OFFICIAL_ARTWORK_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork'

interface NamedResource {
  name: string
  url: string
}

interface PokemonListResponse {
  results: NamedResource[]
}

interface TypeResponse {
  pokemon: Array<{ pokemon: NamedResource }>
}

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
const typeCache = new Map<PokemonTypeName, Promise<Set<string>>>()
const battleCache = new Map<number, Promise<PokemonBattleData>>()

function parseId(url: string): number {
  const match = url.match(/\/(\d+)\/?$/)
  return match ? Number(match[1]) : 0
}

function artworkUrl(id: number): string {
  return OFFICIAL_ARTWORK_BASE + '/' + id + '.png'
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson<T>(url: string, description: string, attempts = 3): Promise<T> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url)

      if (!response.ok) {
        throw new Error(description + ' retornou HTTP ' + response.status + '.')
      }

      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await wait(250 * attempt)
      }
    }
  }

  throw new Error(
    description + ': ' + (lastError instanceof Error ? lastError.message : 'Falha de rede.'),
  )
}

async function loadCatalog(): Promise<PokemonSummary[]> {
  const data = await fetchJson<PokemonListResponse>(
    API_BASE + '/pokemon?limit=2000&offset=0',
    'Falha ao carregar a lista de Pokémon',
  )

  return data.results
    .map((pokemon) => {
      const id = parseId(pokemon.url)

      return {
        id,
        name: pokemon.name,
        types: [],
        imageUrl: artworkUrl(id),
      }
    })
    .filter((pokemon) => pokemon.id > 0)
    .sort((a, b) => a.id - b.id)
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

export async function getPokemonOfType(type: PokemonTypeName): Promise<Set<string>> {
  const cached = typeCache.get(type)

  if (cached) {
    return cached
  }

  const request = fetchJson<TypeResponse>(
    API_BASE + '/type/' + type,
    'Falha ao carregar o tipo ' + type,
  )
    .then((data) => new Set(data.pokemon.map((entry) => entry.pokemon.name)))
    .catch((error) => {
      typeCache.delete(type)
      throw error
    })

  typeCache.set(type, request)
  return request
}

export async function enrichPokemonTypes(
  catalog: PokemonSummary[],
  onProgress?: (catalog: PokemonSummary[]) => void,
): Promise<PokemonSummary[]> {
  const byName = new Map(catalog.map((pokemon) => [pokemon.name, { ...pokemon, types: [] }]))

  for (const type of POKEMON_TYPES) {
    try {
      const names = await getPokemonOfType(type)

      for (const name of names) {
        const pokemon = byName.get(name)

        if (pokemon && !pokemon.types.includes(type)) {
          pokemon.types.push(type)
        }
      }

      onProgress?.(Array.from(byName.values()).sort((a, b) => a.id - b.id))
    } catch {
      // A falha em um tipo não impede os demais tipos de serem carregados.
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.id - b.id)
}

export async function getPokemonBattleData(pokemon: PokemonSummary): Promise<PokemonBattleData> {
  const cached = battleCache.get(pokemon.id)

  if (cached) {
    return cached
  }

  const request = fetchJson<PokemonResponse>(
    API_BASE + '/pokemon/' + pokemon.id,
    'Falha ao carregar os dados de ' + pokemon.name,
  )
    .then((data) => {
      const findStat = (name: string) =>
        data.stats.find((stat) => stat.stat.name === name)?.base_stat ?? 1

      return {
        id: data.id,
        name: data.name,
        types: data.types
          .sort((a, b) => a.slot - b.slot)
          .map((entry) => entry.type.name as PokemonTypeName),
        imageUrl:
          data.sprites.other?.['official-artwork']?.front_default ?? artworkUrl(data.id),
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
