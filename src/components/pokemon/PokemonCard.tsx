import { useState, type DragEvent } from 'react'
import type { PokemonSummary } from '../../types/pokemon'
import { formatPokemonName } from '../../utils/format'
import { TypeBadge } from '../ui/TypeBadge'
import './PokemonCard.css'

interface Props {
  pokemon: PokemonSummary
  onSelect?: (pokemon: PokemonSummary) => void
}

export function PokemonCard({ pokemon, onSelect }: Props) {
  const [imageStatus, setImageStatus] = useState(0)

  function handleImageError() {
    setImageStatus((current) => Math.min(current + 1, 2))
  }

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
        {imageStatus < 2 ? (
          <img
            src={imageStatus === 0
              ? pokemon.imageUrl
              : 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/' + pokemon.id + '.png'}
            alt={formatPokemonName(pokemon.name)}
            loading="lazy"
            onError={handleImageError}
          />
        ) : (
          <div className="pokemon-card__placeholder" role="img" aria-label={'Arte indisponível para ' + formatPokemonName(pokemon.name)}>
            <span>?</span>
          </div>
        )}
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
