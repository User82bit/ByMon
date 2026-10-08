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

export function PokemonBrowser({ catalog, loading, error, onRetry, onSelectPokemon }: Props) {
  const [selectedTypes, setSelectedTypes] = useState<PokemonTypeName[]>([])
  const [search, setSearch] = useState('')
  const [typeMembers, setTypeMembers] = useState<Set<string> | null>(null)
  const [typeLoading, setTypeLoading] = useState(false)
  const [typeError, setTypeError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    if (selectedTypes.length === 0) {
      setTypeMembers(null)
      setTypeError(null)
      setTypeLoading(false)
      return
    }

    setTypeLoading(true)
    setTypeError(null)

    void Promise.all(selectedTypes.map((type) => getPokemonOfType(type)))
      .then((sets) => {
        if (!active) return

        const members = new Set<string>()

        for (const set of sets) {
          for (const name of set) members.add(name)
        }

        setTypeMembers(members)
      })
      .catch((e) => {
        if (active) setTypeError(e instanceof Error ? e.message : 'Não foi possível carregar os tipos selecionados.')
      })
      .finally(() => {
        if (active) setTypeLoading(false)
      })

    return () => { active = false }
  }, [selectedTypes])

  const list = useMemo(() => {
    const query = search.trim().toLowerCase()

    return catalog
      .filter((pokemon) => {
        const matchesType = selectedTypes.length === 0 ? true : typeMembers?.has(pokemon.name) ?? false
        const matchesSearch = !query || pokemon.name.includes(query)
        return matchesType && matchesSearch
      })
      .map((pokemon) => {
        if (selectedTypes.length === 0) return pokemon

        const types = [
          ...selectedTypes.filter((type) => !pokemon.types.includes(type)),
          ...pokemon.types,
        ]

        return { ...pokemon, types }
      })
  }, [catalog, search, selectedTypes, typeMembers])

  function selectType(type: PokemonTypeName) {
    setSelectedTypes((current) => {
      if (current.includes(type)) return current.filter((selected) => selected !== type)
      if (current.length >= 2) return current
      return current.concat(type)
    })
  }

  function clearTypes() {
    setSelectedTypes([])
  }

  const typeLabel = selectedTypes.map(formatPokemonType).join(' + ')

  return (
    <section className="browser">
      <h2>Pokédex</h2>
      <p>Filtre por até 2 tipos, pesquise por nome e arraste para um time ou clique para escolher o destino.</p>

      {error ? (
        <div className="error">{error}<Button variant="secondary" onClick={onRetry}>Tentar novamente</Button></div>
      ) : loading ? (
        <p>Carregando lista de Pokémon...</p>
      ) : (
        <div className="pokemon-grid">
          {list.map((pokemon) => <PokemonCard key={pokemon.id} pokemon={pokemon} onSelect={onSelectPokemon} />)}
          {list.length === 0 && !typeLoading && <div className="empty">Nenhum Pokémon corresponde aos filtros.</div>}
          {typeLoading && selectedTypes.length > 0 && <div className="empty">Carregando Pokémon dos tipos {typeLabel}...</div>}
          {typeError && <div className="error">{typeError}</div>}
        </div>
      )}

      <div className="filters">
        <TextInput label="Pesquisar" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="pikachu" />
        <div>
          <button type="button" onClick={clearTypes} className={selectedTypes.length === 0 ? 'active' : ''}>Todos</button>
          {POKEMON_TYPES.map((type) => {
            const selected = selectedTypes.includes(type)
            const disabled = selectedTypes.length >= 2 && !selected

            return (
              <button
                type="button"
                key={type}
                onClick={() => selectType(type)}
                className={selected ? 'active' : ''}
                disabled={disabled}
                aria-pressed={selected}
                aria-label={disabled ? 'Limite de 2 tipos atingido' : 'Filtrar por ' + formatPokemonType(type)}
              >
                {formatPokemonType(type)}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}