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
  onRemoveTeam: (id: string) => void
  onAddTeam: () => void
  onDropPokemon: (id: string, pokemon: PokemonSummary) => void
  onRemovePokemon: (id: string, pokemonId: number) => void
  onRetryCatalog: () => void
  onBattle: () => void
  battleLoading: boolean
}

export function Home({
  teams,
  catalog,
  loading,
  error,
  onRenameTeam,
  onRemoveTeam,
  onAddTeam,
  onDropPokemon,
  onRemovePokemon,
  onRetryCatalog,
  onBattle,
  battleLoading,
}: Props) {
  const [pendingPokemon, setPendingPokemon] = useState<PokemonSummary | null>(null)
  const canBattle = teams.every((team) => team.pokemon.length > 0) && !battleLoading

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
            <Button variant="secondary" onClick={onAddTeam}>+ Time</Button>
            <Button disabled={!canBattle} onClick={onBattle}>
              {battleLoading ? 'Preparando...' : 'Batalhar'}
            </Button>
          </div>
        </header>

        <div className="teams-grid">
          {teams.map((team, index) => (
            <TeamView
              key={team.id}
              team={team}
              index={index}
              canRemove={teams.length > 2}
              onRename={onRenameTeam}
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
