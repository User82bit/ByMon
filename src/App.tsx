import { useEffect, useState } from 'react'
import { MainLayout } from './layout/MainLayout'
import { Home } from './pages/Home/Home'
import { Battle } from './pages/Battle/Battle'
import { enrichPokemonTypes, getPokemonBattleData, getPokemonCatalog } from './services/pokeapi'
import { simulateBattle } from './utils/battle'
import type { BattleResult, PokemonBattleData, PokemonSummary, Team } from './types/pokemon'
import './App.css'

function emptyTeams(): Team[] {
  return [
    { id: 'team-1', name: 'Time A', pokemon: [] },
    { id: 'team-2', name: 'Time B', pokemon: [] },
  ]
}

function createTeam(): Team {
  return { id: 'team-' + crypto.randomUUID(), name: 'Novo Time', pokemon: [] }
}

export default function App() {
  const [screen, setScreen] = useState<'home' | 'battle'>('home')
  const [teams, setTeams] = useState<Team[]>(emptyTeams)
  const [catalog, setCatalog] = useState<PokemonSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [battleLoading, setBattleLoading] = useState(false)
  const [result, setResult] = useState<BattleResult | null>(null)
  const [details, setDetails] = useState<Map<number, PokemonBattleData>>(new Map())

  async function loadCatalog() {
    setLoading(true)
    setError(null)

    try {
      const basic = await getPokemonCatalog()
      setCatalog(basic)
      setLoading(false)
      void enrichPokemonTypes(basic, setCatalog)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro desconhecido.')
      setLoading(false)
    }
  }

  useEffect(() => { void loadCatalog() }, [])

  function rename(id: string, name: string) {
    setTeams((current) =>
      current.map((team) => team.id === id ? { ...team, name: name || 'Time sem nome' } : team),
    )
  }

  function addTeam() {
    setTeams((current) => current.concat(createTeam()))
  }

  function removeTeam(id: string) {
    if (teams.length > 2) setTeams((current) => current.filter((team) => team.id !== id))
  }

  function addPokemon(id: string, pokemon: PokemonSummary) {
    setTeams((current) =>
      current.map((team) =>
        team.id !== id ||
        team.pokemon.length >= 6 ||
        team.pokemon.some((entry) => entry.id === pokemon.id)
          ? team
          : { ...team, pokemon: team.pokemon.concat(pokemon) },
      ),
    )
  }

  function removePokemon(id: string, pokemonId: number) {
    setTeams((current) =>
      current.map((team) =>
        team.id === id
          ? { ...team, pokemon: team.pokemon.filter((pokemon) => pokemon.id !== pokemonId) }
          : team,
      ),
    )
  }

  async function battle() {
    if (!teams.every((team) => team.pokemon.length > 0)) return

    setBattleLoading(true)

    try {
      const all = teams.flatMap((team) => team.pokemon)
      const data = await Promise.all(all.map((pokemon) => getPokemonBattleData(pokemon)))
      const map = new Map(data.map((pokemon) => [pokemon.id, pokemon]))
      setDetails(map)
      setResult(simulateBattle(teams, map))
      setScreen('battle')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Não foi possível iniciar a batalha.')
    } finally {
      setBattleLoading(false)
    }
  }

  function reset() {
    setScreen('home')
    setTeams(emptyTeams())
    setResult(null)
    setDetails(new Map())
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <MainLayout>
      {screen === 'home'
        ? (
          <Home
            teams={teams}
            catalog={catalog}
            loading={loading}
            error={error}
            onRenameTeam={rename}
            onRemoveTeam={removeTeam}
            onAddTeam={addTeam}
            onDropPokemon={addPokemon}
            onRemovePokemon={removePokemon}
            onRetryCatalog={loadCatalog}
            onBattle={battle}
            battleLoading={battleLoading}
          />
        )
        : result
          ? <Battle result={result} teams={teams} details={details} onReturn={reset} />
          : null}
    </MainLayout>
  )
}
