import type { DragEvent } from 'react'
import type { PokemonSummary } from '../../types/pokemon'
import { formatPokemonName } from '../../utils/format'
import { TypeBadge } from '../ui/TypeBadge'
import './PokemonCard.css'

interface Props {
  pokemon: PokemonSummary
  onSelect?: (pokemon: PokemonSummary) => void
}

export function PokemonCard({ pokemon, onSelect }: Props) {
  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/x-bymon-pokemon', JSON.stringify(pokemon))
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div
      className="pokemon-card"
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect?.(pokemon)}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(event) => {
        if (onSelect && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect(pokemon)
        }
      }}
    >
      <div className="pokemon-card__image-wrap">
        <img src={pokemon.imageUrl} alt={formatPokemonName(pokemon.name)} loading="lazy" />
      </div>
      <div className="pokemon-card__content">
        <strong>{formatPokemonName(pokemon.name)}</strong>
        <div className="pokemon-card__types">
          {pokemon.types.map((type) => <TypeBadge key={type} type={type} />)}
        </div>
      </div>
    </div>
  )
}
