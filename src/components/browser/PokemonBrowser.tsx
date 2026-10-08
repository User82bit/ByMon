import { useEffect, useMemo, useState } from 'react'
import type { PokemonSummary, PokemonTypeName } from '../../types/pokemon'
import { POKEMON_TYPES } from '../../types/pokemon'
import { getPokemonOfType } from '../../services/pokeapi'
import { formatPokemonType } from '../../utils/format'
import { TextInput } from '../ui/TextInput'
import { Button } from '../ui/Button'
import { PokemonCard } from '../pokemon/PokemonCard'
import './PokemonBrowser.css'

interface Props {
  catalog: PokemonSummary[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onSelectPokemon: (pokemon: PokemonSummary) => void
}

export function PokemonBrowser({
  catalog,
  loading,
  error,
  onRetry,
  onSelectPokemon,
}: Props) {
  const [selectedType, setSelectedType] = useState<PokemonTypeName | null>(null)
  const [search, setSearch] = useState('')
  const [typeMembers, setTypeMembers] = useState<Set<string> | null>(null)
  const [typeLoading, setTypeLoading] = useState(false)
  const [typeError, setTypeError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    if (!selectedType) {
      setTypeMembers(null)
      setTypeError(null)
      setTypeLoading(false)
      return
    }

    setTypeLoading(true)
    setTypeError(null)

    void getPokemonOfType(selectedType)
      .then((members) => {
        if (active) setTypeMembers(members)
      })
      .catch((e) => {
        if (active) {
          setTypeError(e instanceof Error ? e.message : 'Não foi possível carregar este tipo.')
        }
      })
      .finally(() => {
        if (active) setTypeLoading(false)
      })

    return () => { active = false }
  }, [selectedType])

  const list = useMemo(() => {
    const query = search.trim().toLowerCase()

    return catalog
      .filter((pokemon) => {
        const matchesType = selectedType ? typeMembers?.has(pokemon.name) ?? false : true
        const matchesSearch = !query || pokemon.name.includes(query)
        return matchesType && matchesSearch
      })
      .map((pokemon) => {
        if (selectedType && !pokemon.types.includes(selectedType)) {
          return { ...pokemon, types: [selectedType, ...pokemon.types] }
        }
        return pokemon
      })
  }, [catalog, search, selectedType, typeMembers])

  async function selectType(type: PokemonTypeName | null) {
    setSelectedType(type)

    if (type) {
      try {
        setTypeLoading(true)
        setTypeError(null)
        setTypeMembers(await getPokemonOfType(type))
      } catch (e) {
        setTypeError(e instanceof Error ? e.message : 'Não foi possível carregar este tipo.')
      } finally {
        setTypeLoading(false)
      }
    }
  }

  return (
    <section className="browser">
      <h2>Pokédex</h2>
      <p>Filtre por tipo, pesquise por nome e arraste para um time ou clique para escolher o destino.</p>

      {error ? (
        <div className="error">
          {error}
          <Button variant="secondary" onClick={onRetry}>Tentar novamente</Button>
        </div>
      ) : loading ? (
        <p>Carregando lista de Pokémon...</p>
      ) : (
        <div className="pokemon-grid">
          {list.map((pokemon) => (
            <PokemonCard
              key={pokemon.id}
              pokemon={pokemon}
              onSelect={onSelectPokemon}
            />
          ))}
          {list.length === 0 && !typeLoading && (
            <div className="empty">Nenhum Pokémon corresponde aos filtros.</div>
          )}
          {typeLoading && selectedType && (
            <div className="empty">Carregando Pokémon do tipo {formatPokemonType(selectedType)}...</div>
          )}
          {typeError && <div className="error">{typeError}</div>}
        </div>
      )}

      <div className="filters">
        <TextInput
          label="Pesquisar"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="pikachu"
        />
        <div>
          <button type="button" onClick={() => selectType(null)}>Todos</button>
          {POKEMON_TYPES.map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => selectType(type)}
              className={selectedType === type ? 'active' : ''}
            >
              {formatPokemonType(type)}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
