import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Team } from '../../components/team/Team'
import { PokemonBrowser } from '../../components/browser/PokemonBrowser'
import {
  getOnlineRoom,
  leaveOnlineRoom,
  setOnlinePlayerReady,
  setOnlinePlayerTeam,
} from '../../services/onlineRooms'
import type { PokemonSummary, Team as TeamModel } from '../../types/pokemon'
import type { OnlineRoom, RoomSession } from '../../types/online'
import './OnlineLobby.css'

interface Props {
  session: RoomSession
  catalog: PokemonSummary[]
  loading: boolean
  error: string | null
  onRetryCatalog: () => void
  onLeave: () => void
}

function teamStorageKey(session: RoomSession): string {
  return 'bymon-online-team:' + session.room.id + ':' + session.playerId
}

export function OnlineLobby({
  session,
  catalog,
  loading,
  error: catalogError,
  onRetryCatalog,
  onLeave,
}: Props) {
  const [room, setRoom] = useState<OnlineRoom>(session.room)
  const [team, setTeam] = useState<TeamModel>({
    id: 'online-team',
    name: 'Meu time',
    pokemon: [],
  })
  const [error, setError] = useState<string | null>(catalogError)
  const [leaving, setLeaving] = useState(false)
  const [saving, setSaving] = useState(false)

  const catalogById = useMemo(
    () => new Map(catalog.map((pokemon) => [pokemon.id, pokemon])),
    [catalog],
  )

  useEffect(() => {
    setError(catalogError)
  }, [catalogError])

  useEffect(() => {
    const raw = window.localStorage.getItem(teamStorageKey(session))
    if (!raw) return

    try {
      const ids = JSON.parse(raw) as number[]
      const pokemon = ids
        .map((id) => catalogById.get(id))
        .filter((entry): entry is PokemonSummary => Boolean(entry))

      setTeam((current) => ({ ...current, pokemon }))
    } catch {
      window.localStorage.removeItem(teamStorageKey(session))
    }
  }, [catalogById, session])

  useEffect(() => {
    let active = true

    async function refresh() {
      try {
        const next = await getOnlineRoom(session.room.id, session.playerId)
        if (active) {
          setRoom(next)
          setError(null)
        }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Sala indisponível.')
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [session.playerId, session.room.id])

  function persistLocalTeam(pokemon: PokemonSummary[]) {
    window.localStorage.setItem(
      teamStorageKey(session),
      JSON.stringify(pokemon.map((entry) => entry.id)),
    )
  }

  async function syncTeam(pokemon: PokemonSummary[]) {
    persistLocalTeam(pokemon)
    setSaving(true)

    try {
      const next = await setOnlinePlayerTeam(
        room.id,
        session.playerId,
        pokemon.map((entry) => entry.id),
      )
      setRoom(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o time.')
    } finally {
      setSaving(false)
    }
  }

  function addPokemon(pokemon: PokemonSummary) {
    if (team.pokemon.length >= 6 || team.pokemon.some((entry) => entry.id === pokemon.id)) return

    const next = team.pokemon.concat(pokemon)
    setTeam((current) => ({ ...current, pokemon: next }))
    void syncTeam(next)
  }

  function removePokemon(pokemonId: number) {
    const next = team.pokemon.filter((pokemon) => pokemon.id !== pokemonId)
    setTeam((current) => ({ ...current, pokemon: next }))
    void syncTeam(next)
  }

  function renameTeam(_: string, name: string) {
    setTeam((current) => ({ ...current, name: name || 'Meu time' }))
  }

  async function toggleReady() {
    const player = room.players.find((entry) => entry.id === session.playerId)
    if (!player) return

    try {
      const next = await setOnlinePlayerReady(
        room.id,
        session.playerId,
        !player.ready,
      )
      setRoom(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível atualizar seu status.')
    }
  }

  async function leave() {
    setLeaving(true)
    try {
      await leaveOnlineRoom(room.id, session.playerId)
      window.localStorage.removeItem(teamStorageKey(session))
    } finally {
      setLeaving(false)
      onLeave()
    }
  }

  const me = room.players.find((entry) => entry.id === session.playerId)
  const everyoneReady =
    room.players.length >= 2 &&
    room.players.every((player) => player.ready && player.teamSize > 0)
  const canReady = team.pokemon.length > 0 && !saving
  const battleStarted = room.status === 'battle'

  return (
    <main className="online-lobby">
      <header className="online-lobby__header">
        <div>
          <div className="online-lobby__eyebrow">
            <b>{battleStarted ? 'PARTIDA ONLINE' : 'LOBBY ONLINE'}</b>
            {session.source === 'lan' && <span>LAN</span>}
          </div>
          <h1>{room.name}</h1>
          <p>Código da sala: <strong>{room.code}</strong></p>
        </div>
        <Button variant="secondary" onClick={() => void leave()} disabled={leaving}>
          {leaving ? 'Saindo...' : 'Sair'}
        </Button>
      </header>

      {error && <div className="online-error">{error}</div>}

      {battleStarted ? (
        <section className="online-lobby__started">
          <strong>Todos os jogadores ficaram prontos.</strong>
          <p>A sala recebeu o sinal de início da partida.</p>
          <small>A sincronização da batalha online será conectada a esta etapa na próxima camada.</small>
        </section>
      ) : (
        <>
          <section className="online-lobby__card">
            <div className="online-lobby__section-header">
              <div>
                <h2>Seu time</h2>
                <small>{team.pokemon.length}/6 Pokémon</small>
              </div>
              <span>{me?.ready ? 'Pronto' : 'Montando'}</span>
            </div>

            <Team
              team={team}
              index={0}
              canRemove={false}
              onRename={renameTeam}
              onRemove={() => undefined}
              onDropPokemon={(_, pokemon) => addPokemon(pokemon)}
              onRemovePokemon={(_, pokemonId) => removePokemon(pokemonId)}
            />

            <div className="online-lobby__ready">
              <p>
                {me?.ready
                  ? 'Você está pronto. Alterar o time cancela automaticamente o pronto.'
                  : team.pokemon.length === 0
                    ? 'Escolha pelo menos 1 Pokémon antes de ficar pronto.'
                    : 'Seu time está pronto para a batalha.'}
              </p>
              <Button disabled={!canReady} onClick={() => void toggleReady()}>
                {me?.ready ? 'Cancelar pronto' : saving ? 'Salvando...' : 'Estou pronto'}
              </Button>
            </div>
          </section>

          <PokemonBrowser
            catalog={catalog}
            loading={loading}
            error={catalogError}
            onRetry={onRetryCatalog}
            onSelectPokemon={addPokemon}
          />

          <section className="online-lobby__card">
            <div className="online-lobby__section-header">
              <div>
                <h2>Jogadores</h2>
                <small>{room.players.length}/{room.maxPlayers}</small>
              </div>
              <span>{room.private ? 'Privada' : 'Pública'}</span>
            </div>

            {room.players.map((player) => (
              <div className="online-player" key={player.id}>
                <div>
                  <strong>{player.name}</strong>
                  <small>
                    {player.host ? 'Host' : player.ready ? 'Pronto' : 'Montando time'}
                    {player.teamSize > 0 ? ' · ' + player.teamSize + '/6' : ''}
                  </small>
                </div>
                {player.host && <span>Host</span>}
              </div>
            ))}

            <div className="online-lobby__status">
              {room.players.length < 2
                ? 'Aguardando outro jogador.'
                : everyoneReady
                  ? 'Todos estão prontos. Iniciando a partida...'
                  : 'Cada jogador monta seu próprio time e marca-se como pronto.'}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
