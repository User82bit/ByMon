import { useState } from 'react'
import type { PokemonSummary, Team } from '../../types/pokemon'
import { Button } from '../../components/ui/Button'
import { Team as TeamView } from '../../components/team/Team'
import { TeamPicker } from '../../components/team/TeamPicker'
import { PokemonBrowser } from '../../components/browser/PokemonBrowser'
import './Home.css'

interface Props {
  teams: Team[]
  catalog: PokemonSummary[]
  loading: boolean
  error: string | null
  onRenameTeam: (id: string, name: string) => void
  onChangeTeamColor: (id: string, color: string) => void
  onRemoveTeam: (id: string) => void
  onAddTeam: () => void
  onDropPokemon: (id: string, pokemon: PokemonSummary) => void
  onRemovePokemon: (id: string, pokemonId: number) => void
  onRetryCatalog: () => void
  onBattle: () => void
  battleLoading: boolean
  onOnline: () => void
}

export function Home({
  teams,
  catalog,
  loading,
  error,
  onRenameTeam,
  onChangeTeamColor,
  onRemoveTeam,
  onAddTeam,
  onDropPokemon,
  onRemovePokemon,
  onRetryCatalog,
  onBattle,
  battleLoading,
  onOnline,
}: Props) {
  const [pendingPokemon, setPendingPokemon] = useState<PokemonSummary | null>(null)
  const canBattle = teams.every((team) => team.pokemon.length > 0) && !battleLoading
  const duplicateColors = teams.some((team, index) => teams.slice(index + 1).some(other => team.color.toLowerCase() === other.color.toLowerCase()))

  function chooseTeam(teamId: string) {
    if (!pendingPokemon) return
    onDropPokemon(teamId, pendingPokemon)
    setPendingPokemon(null)
  }

  return (
    <main>
      <section className="teams-section">
        <header>
          <div>
            <b>ByMon</b>
            <h1>Monte seus times</h1>
            <p>Arraste Pokémon para um time ou clique em um Pokémon para escolher o destino.</p>
          </div>
          <div>
            <Button variant="secondary" onClick={onOnline}>Online</Button>
            <Button variant="secondary" onClick={onAddTeam}>+ Time</Button>
            <Button disabled={!canBattle} onClick={onBattle}>
              {battleLoading ? 'Preparando...' : 'Batalhar'}
            </Button>
          </div>
        </header>

        {duplicateColors && <p className="team-color-warning" role="status">Alguns times usam a mesma cor. Escolha cores diferentes para facilitar a leitura da batalha.</p>}

        <div className="teams-grid">
          {teams.map((team, index) => (
            <TeamView
              key={team.id}
              team={team}
              index={index}
              canRemove={teams.length > 2}
              onRename={onRenameTeam}
              onChangeColor={onChangeTeamColor}
              onRemove={onRemoveTeam}
              onDropPokemon={onDropPokemon}
              onRemovePokemon={onRemovePokemon}
            />
          ))}
        </div>

        {!canBattle && !battleLoading && (
          <small>Cada time precisa ter pelo menos 1 Pokémon.</small>
        )}
      </section>

      <PokemonBrowser
        catalog={catalog}
        loading={loading}
        error={error}
        onRetry={onRetryCatalog}
        onSelectPokemon={setPendingPokemon}
      />

      {pendingPokemon && (
        <TeamPicker
          pokemon={pendingPokemon}
          teams={teams}
          onSelect={chooseTeam}
          onClose={() => setPendingPokemon(null)}
        />
      )}
    </main>
  )
}
