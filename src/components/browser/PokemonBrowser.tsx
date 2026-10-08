import { useMemo, useState } from 'react'
import type { PokemonSummary, PokemonTypeName } from '../../types/pokemon'
import { POKEMON_TYPES } from '../../types/pokemon'
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
  const [selectedTypes, setSelectedTypes] = useState<PokemonTypeName[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'all' | 'normal' | 'gmax' | 'dynamax'>('all')

  const list = useMemo(() => {
    const query = search.trim().toLowerCase()

    return catalog.filter((pokemon) => {
      const matchesType =
        selectedTypes.length === 0
          ? true
          : selectedTypes.length === 1
            ? pokemon.types.includes(selectedTypes[0])
            : pokemon.types.length === 2 &&
              selectedTypes.every((type) => pokemon.types.includes(type))

      const matchesSearch = !query || pokemon.name.includes(query)
      const matchesCategory = category === 'all' || pokemon.kind === category

      return matchesType && matchesSearch && matchesCategory
    })
  }, [catalog, search, selectedTypes, category])

  function selectType(type: PokemonTypeName) {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        return current.filter((selected) => selected !== type)
      }

      if (current.length >= 2) {
        return current
      }

      return current.concat(type)
    })
  }

  function clearTypes() {
    setSelectedTypes([])
  }

  return (
    <section className="browser">
      <h2>Pokédex</h2>
      <p>Filtre por até 2 tipos, pesquise por nome e arraste para um time ou clique para escolher o destino.</p>

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
          {list.length === 0 && (
            <div className="empty">Nenhum Pokémon corresponde aos filtros.</div>
          )}
        </div>
      )}

      <div className="filters">
        <TextInput
          label="Pesquisar"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="pikachu"
        />
        <div className="filter-chips" aria-label="Categoria do Pokémon">
          {([{value:'all',label:'Todos'},{value:'normal',label:'Normal'},{value:'gmax',label:'Gmax'},{value:'dynamax',label:'Dynamax'}] as const).map(option => <button key={option.value} type="button" className={category === option.value ? 'active' : ''} aria-pressed={category === option.value} onClick={() => setCategory(option.value)}>{option.label}</button>)}
        </div>
        <div>
          <button
            type="button"
            onClick={clearTypes}
            className={selectedTypes.length === 0 ? 'active' : ''}
          >
            Todos
          </button>

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
