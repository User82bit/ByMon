import { formatPokemonType } from '../../utils/format'
import './TypeBadge.css'

export function TypeBadge({ type }: { type: string }) {
  return <span className={'type-badge type-badge--' + type}>{formatPokemonType(type)}</span>
}
