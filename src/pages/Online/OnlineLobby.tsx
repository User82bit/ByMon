import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { getOnlineRoom, leaveOnlineRoom, setOnlinePlayerReady } from '../../services/onlineRooms'
import type { OnlineRoom, RoomSession } from '../../types/online'
import './OnlineLobby.css'

interface Props {
  session: RoomSession
  onLeave: () => void
}

export function OnlineLobby({ session, onLeave }: Props) {
  const [room, setRoom] = useState<OnlineRoom>(session.room)
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

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

  async function toggleReady() {
    const player = room.players.find((entry) => entry.id === session.playerId)
    if (!player) return

    try {
      setRoom(await setOnlinePlayerReady(room.id, session.playerId, !player.ready))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível atualizar seu status.')
    }
  }

  async function leave() {
    setLeaving(true)
    try {
      await leaveOnlineRoom(room.id, session.playerId)
    } finally {
      setLeaving(false)
      onLeave()
    }
  }

  const me = room.players.find((entry) => entry.id === session.playerId)
  const everyoneReady = room.players.length >= 2 && room.players.every((player) => player.ready)

  return (
    <main className="online-lobby">
      <header className="online-lobby__header">
        <div>
          <b>LOBBY ONLINE</b>
          <h1>{room.name}</h1>
          <p>
            Código da sala: <strong>{room.code}</strong>
          </p>
        </div>
        <Button variant="secondary" onClick={() => void leave()} disabled={leaving}>
          {leaving ? 'Saindo...' : 'Sair'}
        </Button>
      </header>

      {error && <div className="online-error">{error}</div>}

      <section className="online-lobby__card">
        <div className="online-lobby__players">
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
                <small>{player.host ? 'Host' : player.ready ? 'Pronto' : 'Aguardando'}</small>
              </div>
              {player.host && <span>Host</span>}
            </div>
          ))}
        </div>

        <div className="online-lobby__actions">
          <p>
            {room.players.length < 2
              ? 'Aguardando outro jogador.'
              : everyoneReady
                ? 'Todos os jogadores estão prontos.'
                : 'Marque-se como pronto quando terminar de montar seu time.'}
          </p>
          <Button onClick={() => void toggleReady()}>
            {me?.ready ? 'Cancelar pronto' : 'Estou pronto'}
          </Button>
        </div>
      </section>

      <section className="online-lobby__next">
        <h2>Próxima etapa</h2>
        <p>A batalha online será liberada quando o sistema de equipes compartilhadas estiver integrado ao lobby.</p>
      </section>
    </main>
  )
}
