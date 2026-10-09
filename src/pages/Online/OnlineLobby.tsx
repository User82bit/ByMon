import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Team } from '../../components/team/Team'
import { PokemonBrowser } from '../../components/browser/PokemonBrowser'
import {
  getOnlineRoom,
  leaveOnlineRoom,
  setOnlineRoomStatus,
  setOnlinePlayerState,
} from '../../services/onlineRooms'
import {
  OnlineP2PHost,
  OnlineP2PPeer,
  getOnlineTeamColor,
} from '../../services/onlineP2P'
import type { PokemonSummary, Team as TeamModel } from '../../types/pokemon'
import type {
  OnlineRoom,
  P2PPlayerState,
  P2PSnapshot,
  RoomSession,
} from '../../types/online'
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

function initialSnapshot(room: OnlineRoom): P2PSnapshot {
  return {
    status: room.status,
    players: room.players.map((player, index) => ({
      id: player.id,
      name: player.name,
      host: player.host,
      ready: player.ready,
      teamPokemonIds: [],
      teamSize: player.teamSize,
      teamColor: getOnlineTeamColor(index),
    })),
  }
}

function mergePlayers(
  room: OnlineRoom,
  snapshotPlayers: P2PPlayerState[],
): P2PPlayerState[] {
  const stateById = new Map(snapshotPlayers.map((player) => [player.id, player]))

  return room.players.map((player, index) => {
    const current = stateById.get(player.id)
    return {
      id: player.id,
      name: player.name,
      host: player.host,
      // The API is authoritative for readiness; P2P enriches the actual team IDs.
      ready: player.ready,
      teamPokemonIds: current?.teamPokemonIds ?? [],
      teamSize: player.teamSize,
      teamColor: current?.teamColor ?? getOnlineTeamColor(index),
    }
  })
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
  const [snapshot, setSnapshot] = useState<P2PSnapshot>(() => initialSnapshot(session.room))
  const [team, setTeam] = useState<TeamModel>({
    id: 'online-team',
    name: 'Meu time',
    color: getOnlineTeamColor(Math.max(0, session.room.players.findIndex((player) => player.id === session.playerId))),
    pokemon: [],
  })
  const [teamLoaded, setTeamLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [p2pConnected, setP2pConnected] = useState(session.room.players.length < 2)

  const p2pRef = useRef<OnlineP2PHost | OnlineP2PPeer | null>(null)
  const teamRef = useRef(team)
  const stateSyncRef = useRef<Promise<void>>(Promise.resolve())

  const isHost = session.playerId === session.room.hostId

  const catalogById = useMemo(
    () => new Map(catalog.map((pokemon) => [pokemon.id, pokemon])),
    [catalog],
  )

  useEffect(() => {
    teamRef.current = team
  }, [team])

  function persistServerPlayerState(ready: boolean, teamSize: number) {
    stateSyncRef.current = stateSyncRef.current
      .catch(() => undefined)
      .then(async () => {
        const nextRoom = await setOnlinePlayerState(
          session.room.id,
          session.playerId,
          session.sessionToken,
          ready,
          teamSize,
        )
        setRoom(nextRoom)
        setError(null)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Não foi possível sincronizar o estado do jogador.')
      })
  }

  function syncServerPlayerState(ready: boolean, teamSize: number) {
    // Update local UI immediately; persist writes in order to prevent stale state.
    setRoom((current) => ({
      ...current,
      players: current.players.map((player) => player.id === session.playerId
        ? { ...player, ready: ready && teamSize > 0, teamSize, lastSeen: Date.now() }
        : player),
    }))
    persistServerPlayerState(ready, teamSize)
  }

  useEffect(() => {
    if (loading) return
    let active = true

    async function restoreStoredTeam() {
      // Resolve persisted data asynchronously to avoid a cascading synchronous render.
      await Promise.resolve()
      if (!active) return

      try {
        const raw = window.localStorage.getItem(teamStorageKey(session))
        if (raw) {
          const stored = JSON.parse(raw) as unknown
          const isLegacyList = Array.isArray(stored)
          const record = stored && typeof stored === 'object' && !isLegacyList
            ? stored as { pokemonIds?: unknown; color?: unknown }
            : null
          const ids = isLegacyList
            ? stored.filter((id): id is number => Number.isInteger(id))
            : Array.isArray(record?.pokemonIds)
              ? record.pokemonIds.filter((id): id is number => Number.isInteger(id))
              : []
          const color = typeof record?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(record.color)
            ? record.color.toUpperCase()
            : getOnlineTeamColor(Math.max(0, session.room.players.findIndex((player) => player.id === session.playerId)))
          const pokemon = ids
            .map((id) => catalogById.get(id))
            .filter((entry): entry is PokemonSummary => Boolean(entry))

          setTeam((current) => ({ ...current, color, pokemon }))
        }
      } catch {
        window.localStorage.removeItem(teamStorageKey(session))
      } finally {
        if (active) setTeamLoaded(true)
      }
    }

    void restoreStoredTeam()

    return () => {
      active = false
    }
  }, [catalogById, loading, session])

  useEffect(() => {
    let active = true

    const callbacks = {
      onSnapshot(next: P2PSnapshot) {
        if (!active) return
        setSnapshot(next)
        setError(null)
      },
      onConnectionChange(connected: boolean) {
        if (!active) return
        setP2pConnected(connected)
      },
      onError(nextError: Error) {
        if (!active) return
        setError(nextError.message)
      },
      onBattleStart(next: P2PSnapshot) {
        if (!active) return
        setSnapshot(next)
      },
    }

    const transport = isHost
      ? new OnlineP2PHost(session, {
          ...callbacks,
          onBattleStart: async (next) => {
            callbacks.onBattleStart(next)

            try {
              const nextRoom = await setOnlineRoomStatus(
                session.room.id,
                session.playerId,
                session.sessionToken,
                'battle',
              )

              if (active) setRoom(nextRoom)
            } catch (e) {
              if (active) {
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Não foi possível registrar o início da partida.',
                )
              }
            }
          },
        })
      : new OnlineP2PPeer(session, callbacks)

    p2pRef.current = transport
    transport.start()

    return () => {
      active = false
      transport.close()
      p2pRef.current = null
    }
  }, [isHost, session])

  useEffect(() => {
    let active = true

    async function refresh() {
      try {
        const next = await getOnlineRoom(
          session.room.id,
          session.playerId,
          session.sessionToken,
        )

        if (!active) return

        setRoom(next)

        if (isHost && p2pRef.current instanceof OnlineP2PHost) {
          p2pRef.current.syncRoom(next)
        }

        if (next.hostId !== session.room.hostId && !isHost) {
          setError('O host desta sala mudou. Esta sala requer uma nova conexão.')
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Sala indisponível.')
        }
      }
    }

    void refresh()
    const timer = window.setInterval(() => void refresh(), 10000)

    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [isHost, session])

  function persistLocalTeam(pokemon: PokemonSummary[], color: string) {
    window.localStorage.setItem(
      teamStorageKey(session),
      JSON.stringify({
        pokemonIds: pokemon.map((entry) => entry.id),
        color,
      }),
    )
  }

  function syncTeam(pokemon: PokemonSummary[], color = team.color) {
    persistLocalTeam(pokemon, color)

    const transport = p2pRef.current
    if (!transport) return

    const ids = pokemon.map((entry) => entry.id)
    if (isHost && transport instanceof OnlineP2PHost) {
      transport.updateLocalTeam(ids, color)
      return
    }

    if (!isHost && transport instanceof OnlineP2PPeer && transport.isConnected()) {
      transport.sendTeam(ids, color)
    }
  }

  function changeTeamColor(_: string, color: string) {
    setTeam((current) => ({ ...current, color }))
    syncTeam(team.pokemon, color)
  }

  function addPokemon(pokemon: PokemonSummary) {
    if (team.pokemon.length >= 6 || team.pokemon.some((entry) => entry.id === pokemon.id)) return

    const next = team.pokemon.concat(pokemon)
    setTeam((current) => ({ ...current, pokemon: next }))
    syncTeam(next)
  }

  function removePokemon(pokemonId: number) {
    const next = team.pokemon.filter((pokemon) => pokemon.id !== pokemonId)
    setTeam((current) => ({ ...current, pokemon: next }))
    syncTeam(next)
  }

  function renameTeam(_: string, name: string) {
    setTeam((current) => ({ ...current, name: name || 'Meu time' }))
  }

  useEffect(() => {
    if (!teamLoaded) return
    persistServerPlayerState(false, team.pokemon.length)
    // List identity changes on add/remove/replace, but not on color-only edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamLoaded, team.pokemon, session])

  useEffect(() => {
    if (!teamLoaded) return

    const currentTeam = teamRef.current
    const ids = currentTeam.pokemon.map((entry) => entry.id)
    const transport = p2pRef.current
    if (isHost && transport instanceof OnlineP2PHost) {
      transport.updateLocalTeam(ids, currentTeam.color)
    } else if (!isHost && p2pConnected && transport instanceof OnlineP2PPeer) {
      transport.sendTeam(ids, currentTeam.color)
    }
  }, [teamLoaded, p2pConnected, isHost, session])

  function toggleReady() {
    const me = room.players.find((entry) => entry.id === session.playerId)
    if (!me) return

    if (!me.ready && team.pokemon.length === 0) {
      setError('Monte seu time antes de ficar pronto.')
      return
    }

    const nextReady = !me.ready
    syncServerPlayerState(nextReady, team.pokemon.length)

    const transport = p2pRef.current
    if (isHost && transport instanceof OnlineP2PHost) {
      transport.updateLocalReady(nextReady)
    } else if (!isHost && transport instanceof OnlineP2PPeer && transport.isConnected()) {
      transport.sendReady(nextReady)
    }
  }

  async function leave() {
    setLeaving(true)

    try {
      p2pRef.current?.close()
      await leaveOnlineRoom(
        room.id,
        session.playerId,
        session.sessionToken,
      )
      window.localStorage.removeItem(teamStorageKey(session))
    } finally {
      setLeaving(false)
      onLeave()
    }
  }

  const players = mergePlayers(room, snapshot.players)
  const me = players.find((player) => player.id === session.playerId)
  const everyoneReady =
    players.length >= 2 &&
    players.every((player) => player.ready && player.teamSize > 0)
  const battleStarted = snapshot.status === 'battle' || room.status === 'battle'

  return (
    <main className="online-lobby">
      <header className="online-lobby__header">
        <div>
          <b>{battleStarted ? 'PARTIDA ONLINE' : 'LOBBY ONLINE'}</b>
          <h1>{room.name}</h1>
          <p>
            Código da sala: <strong>{room.code}</strong>
          </p>
          <small>
            {isHost
              ? 'Seu navegador é o servidor temporário desta sala.'
              : p2pConnected
                ? 'Conexão direta com o host estabelecida.'
                : 'Conexão direta pendente; o status do lobby continua sincronizado pelo servidor.'}
          </small>
        </div>

        <Button variant="secondary" onClick={() => void leave()} disabled={leaving}>
          {leaving ? 'Saindo...' : 'Sair'}
        </Button>
      </header>

      {(error ?? catalogError) && <div className="online-error">{error ?? catalogError}</div>}

      {battleStarted ? (
        <section className="online-lobby__started">
          <strong>Todos os jogadores ficaram prontos.</strong>
          <p>O host iniciou a partida pela conexão P2P.</p>
          <small>
            O próximo passo é conectar este estado ao campo de batalha online.
          </small>
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
              onChangeColor={changeTeamColor}
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
              <Button onClick={toggleReady}>
                {me?.ready ? 'Cancelar pronto' : 'Estou pronto'}
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
                <small>{players.length}/{room.maxPlayers}</small>
              </div>
              <span>{room.private ? 'Privada' : 'Pública'}</span>
            </div>

            {players.map((player) => (
              <div className="online-player" key={player.id}>
                <div>
                  <strong>{player.name}</strong>
                  <small>
                    {player.host
                      ? player.ready
                        ? 'Host · Pronto'
                        : 'Host · Montando time'
                      : player.ready
                        ? 'Pronto'
                        : 'Montando time'}
                    {player.teamSize > 0
                      ? ' · ' + player.teamSize + '/6'
                      : ''}
                  </small>
                </div>

                {player.host && <span>Host</span>}
              </div>
            ))}

            <div className="online-lobby__status">
              {players.length < 2
                ? 'Aguardando outro jogador.'
                : !p2pConnected && !isHost
                  ? 'A conexão direta ainda não está disponível; você pode marcar pronto normalmente.'
                  : everyoneReady
                    ? 'Todos estão prontos. O host está iniciando a partida...'
                    : 'Cada jogador monta seu próprio time e marca-se como pronto.'}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
