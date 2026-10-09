import { POKEMON_TYPES, type PokemonBattleData, type PokemonSummary, type PokemonTypeName } from '../types/pokemon'

const API_BASE = '/api/pokeapi?path='
const OFFICIAL_ARTWORK_BASE =
  'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork'

interface NamedResource {
  name: string
  url: string
}

interface CatalogResponse {
  count: number
  results: NamedResource[]
}

interface TypeResponse {
  pokemon: Array<{ pokemon: NamedResource }>
}

interface PokemonResponse {
  id: number
  name: string
  species: NamedResource
  moves: Array<{ move: NamedResource }>
  height: number
  weight: number
  base_experience: number
  types: Array<{ slot: number; type: NamedResource }>
  abilities: Array<{ ability: NamedResource; is_hidden: boolean }>
  stats: Array<{ base_stat: number; stat: NamedResource }>
  sprites: { other?: { 'official-artwork'?: { front_default: string | null } } }
}

let catalogPromise: Promise<PokemonSummary[]> | null = null
const typeCache = new Map<PokemonTypeName, Promise<Set<number>>>()
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

function isExcludedCosmeticForm(name: string): boolean {
  return name.includes('-totem') ||
    /-(cap|starter|cosplay|rock-star|belle|pop-star|phd|libre)$/.test(name)
}

function sortCatalog(a: PokemonSummary, b: PokemonSummary): number {
  const aIsForm = a.id >= 10000
  const bIsForm = b.id >= 10000

  if (aIsForm !== bIsForm) return aIsForm ? 1 : -1
  return a.id - b.id
}

async function loadCatalog(): Promise<PokemonSummary[]> {
  let data = await fetchJson<CatalogResponse>(
    API_BASE + encodeURIComponent('/pokemon?limit=2000'),
    'Falha ao carregar o catálogo de Pokémon',
  )

  if (data.results.length < data.count) {
    data = await fetchJson<CatalogResponse>(
      API_BASE + encodeURIComponent('/pokemon?limit=' + data.count),
      'Falha ao completar o catálogo de Pokémon',
    )
  }

  if (data.results.length < data.count) {
    throw new Error(
      'O catálogo recebido está incompleto (' +
      data.results.length + ' de ' + data.count + ' Pokémon). Tente novamente.',
    )
  }

  return data.results
    .filter((entry) => !isExcludedCosmeticForm(entry.name))
    .map((entry) => {
      const id = parseId(entry.url)

      const kind: PokemonSummary['kind'] = entry.name.endsWith('-gmax') ? 'gmax' : 'normal'

      return {
        id,
        name: entry.name,
        types: [],
        imageUrl: artworkUrl(id),
        kind,
      }
    })
    .filter((pokemon) => pokemon.id > 0)
    .sort(sortCatalog)
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

export async function getPokemonOfType(type: PokemonTypeName): Promise<Set<number>> {
  const cached = typeCache.get(type)

  if (cached) {
    return cached
  }

  const request = fetchJson<TypeResponse>(
    API_BASE + encodeURIComponent('/type/' + type),
    'Falha ao carregar o tipo ' + type,
  )
    .then((data) => new Set(
      data.pokemon
        .map((entry) => parseId(entry.pokemon.url))
        .filter((id) => id > 0),
    ))
    .catch((error) => {
      typeCache.delete(type)
      throw error
    })

  typeCache.set(type, request)
  return request
}

export async function enrichPokemonTypes(catalog: PokemonSummary[]): Promise<PokemonSummary[]> {
  const typeSets = await Promise.all(
    POKEMON_TYPES.map(async (type) => ({
      type,
      ids: await getPokemonOfType(type),
    })),
  )

  const byId = new Map(
    catalog.map((pokemon) => [
      pokemon.id,
      { ...pokemon, types: [] as PokemonTypeName[] },
    ]),
  )

  for (const { type, ids } of typeSets) {
    for (const id of ids) {
      const pokemon = byId.get(id)

      if (pokemon && !pokemon.types.includes(type)) {
        pokemon.types.push(type)
      }
    }
  }

  const enriched = Array.from(byId.values()).sort(sortCatalog)
  const baseSpecies = enriched.filter((pokemon) => pokemon.id < 10000 && pokemon.kind === 'normal')
  const dynamax = baseSpecies.map((pokemon) => ({
    ...pokemon,
    id: 200000 + pokemon.id,
    baseId: pokemon.id,
    name: pokemon.name + '-dynamax',
    // Dynamax preserves the Pokémon's model; the UI adds the Dynamax aura and scale.
    // Always use the real species ID for the artwork, not the synthetic catalog ID.
    imageUrl: artworkUrl(pokemon.id),
    kind: 'dynamax' as const,
  }))
  return enriched.concat(dynamax)
}

export async function getPokemonBattleData(pokemon: PokemonSummary): Promise<PokemonBattleData> {
  const requestId = pokemon.kind === 'dynamax' ? (pokemon.baseId ?? pokemon.id - 200000) : pokemon.id
  const cached = battleCache.get(pokemon.id)

  if (cached) {
    return cached
  }

  const request = fetchJson<PokemonResponse>(
    API_BASE + encodeURIComponent('/pokemon/' + requestId),
    'Falha ao carregar os dados de ' + pokemon.name,
  )
    .then((data) => {
      const findStat = (name: string) =>
        data.stats.find((stat) => stat.stat.name === name)?.base_stat ?? 1

      return {
        id: pokemon.id,
        name: pokemon.name,
        kind: pokemon.kind,
        baseId: pokemon.baseId,
        speciesId: parseId(data.species.url),
        moves: data.moves.map((entry) => entry.move.name),
        types: data.types
          .sort((a, b) => a.slot - b.slot)
          .map((entry) => entry.type.name as PokemonTypeName),
        imageUrl:
          data.sprites.other?.['official-artwork']?.front_default ?? artworkUrl(requestId),
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
