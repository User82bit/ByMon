import type { PokemonSummary, Team } from '../../types/pokemon'
import { Button } from '../ui/Button'
import { formatPokemonName } from '../../utils/format'
import './TeamPicker.css'

interface Props {
  pokemon: PokemonSummary
  teams: Team[]
  onSelect: (teamId: string) => void
  onClose: () => void
}

export function TeamPicker({ pokemon, teams, onSelect, onClose }: Props) {
  return (
    <div className="team-picker" role="dialog" aria-modal="true" aria-label="Escolher time">
      <button type="button" className="team-picker__backdrop" onClick={onClose} aria-label="Fechar" />
      <div className="team-picker__panel">
        <div className="team-picker__header">
          <div>
            <strong>Adicionar {formatPokemonName(pokemon.name)}</strong>
            <p>Escolha o time que receberá este Pokémon.</p>
          </div>
          <button type="button" className="team-picker__close" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <div className="team-picker__pokemon">
          <img src={pokemon.imageUrl} alt="" />
          <span>{formatPokemonName(pokemon.name)}</span>
        </div>

        <div className="team-picker__teams">
          {teams.map((team) => {
            const full = team.pokemon.length >= 6
            const duplicate = team.pokemon.some((entry) => entry.id === pokemon.id)
            const disabled = full || duplicate

            return (
              <Button
                key={team.id}
                disabled={disabled}
                onClick={() => onSelect(team.id)}
                className="team-picker__team"
              >
                <span>{team.name}</span>
                <small>
                  {duplicate ? 'Já está neste time' : full ? 'Time cheio' : team.pokemon.length + '/6'}
                </small>
              </Button>
            )
          })}
        </div>

        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
      </div>
    </div>
  )
}