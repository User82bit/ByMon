import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { createOnlineRoom, joinOnlineRoom, listOnlineRooms, ONLINE_LAN_MODE } from '../../services/onlineRooms'
import type { RoomListItem, RoomSession } from '../../types/online'
import './OnlineServers.css'

interface Props {
  playerName: string
  onPlayerNameChange: (name: string) => void
  onJoin: (session: RoomSession) => void
  onBack: () => void
}

export function OnlineServers({
  playerName,
  onPlayerNameChange,
  onJoin,
  onBack,
}: Props) {
  const [rooms, setRooms] = useState<RoomListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [joinRoom, setJoinRoom] = useState<RoomListItem | null>(null)
  const [password, setPassword] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [mode, setMode] = useState<OnlineMode>('local')
  const [form, setForm] = useState({
    name: 'Minha sala',
    maxPlayers: 4,
    private: false,
    password: '',
  })

  const load = useCallback(async () => {
    try {
      setError(null)
      const [nextMode, nextRooms] = await Promise.all([
        getOnlineMode(),
        listOnlineRooms(),
      ])
      setMode(nextMode)
      setRooms(nextRooms)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível carregar as salas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  async function createRoom() {
    setCreating(true)
    try {
      const session = await createOnlineRoom({
        ...form,
        playerName: playerName.trim() || 'Jogador',
      })
      onJoin(session)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar a sala.')
    } finally {
      setCreating(false)
    }
  }

  async function joinSelectedRoom(room: RoomListItem) {
    if (room.passwordRequired && !password.trim()) return

    setJoining(true)
    try {
      const session = await joinOnlineRoom({
        roomId: room.id,
        password,
        playerName: playerName.trim() || 'Jogador',
      })
      onJoin(session)
      setJoinRoom(null)
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar na sala.')
    } finally {
      setJoining(false)
    }
  }

  async function joinByCode() {
    if (!joinCode.trim()) return

    setJoining(true)
    try {
      const session = await joinOnlineRoom({
        code: joinCode.trim(),
        password,
        playerName: playerName.trim() || 'Jogador',
      })
      onJoin(session)
      setJoinCode('')
      setPassword('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível entrar na sala.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <main className="online-page">
      <header className="online-page__header">
        <div>
          <b>BYMON ONLINE</b>
          <h1>Salas de batalha</h1>
          <p>
            {ONLINE_LAN_MODE
              ? 'Modo LAN ativo: as salas ficam disponíveis para os dispositivos conectados à mesma rede.'
              : 'Crie uma sala ou entre em uma partida existente.'}
          </p>
        </div>
        <Button variant="secondary" onClick={onBack}>Voltar</Button>
      </header>

      {ONLINE_LAN_MODE && (
        <section className="online-lan-notice">
          <strong>Servidor LAN local</strong>
          <p>
            Esta máquina está servindo as salas pela própria rede. Nos outros dispositivos,
            abra o ByMon usando o endereço IP desta máquina na rede local.
          </p>
        </section>
      )}

      <section className="online-page__bar">
        <label>
          Seu nome
          <input
            value={playerName}
            maxLength={20}
            onChange={(event) => onPlayerNameChange(event.target.value)}
            placeholder="Jogador"
          />
        </label>
        <div className="online-page__actions">
          <Button variant="secondary" onClick={() => setShowCreate(true)}>+ Criar sala</Button>
        </div>
      </section>

      <section className="online-servers">
        <div className="online-servers__header">
          <div>
            <h2>Salas públicas</h2>
            <small>Atualização automática a cada 3 segundos.</small>
          </div>
          <Button variant="secondary" onClick={() => void load()}>Atualizar</Button>
        </div>

        {error && <div className="online-error">{error}</div>}
        {loading ? (
          <p>Carregando salas...</p>
        ) : rooms.length === 0 ? (
          <div className="online-empty">Nenhuma sala pública disponível.</div>
        ) : (
          <div className="online-room-list">
            {rooms.map((room) => (
              <article className="online-room" key={room.id}>
                <div>
                  <div className="online-room__title">
                    <span className="online-room__name">{room.name}</span>
                    {room.source === 'lan' && <span className="online-room__tag">LAN</span>}
                  </div>
                  <p>
                    Host: {room.players.find((player) => player.host)?.name ?? 'Host'} ·{' '}
                    {room.players.length}/{room.maxPlayers} jogadores
                  </p>
                </div>
                <div className="online-room__actions">
                  {room.passwordRequired && <small>Senha</small>}
                  <Button
                    disabled={room.players.length >= room.maxPlayers}
                    onClick={() => {
                      setJoinRoom(room)
                      setPassword('')
                    }}
                  >
                    Entrar
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="online-code">
        <div>
          <h2>Entrar por código</h2>
          <p>Use o código da sala compartilhado pelo host.</p>
        </div>
        <div className="online-code__fields">
          <input
            value={joinCode}
            maxLength={6}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            placeholder="X7K4PZ"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Senha, se houver"
          />
          <Button onClick={() => void joinByCode()} disabled={joining || !joinCode.trim()}>
            Entrar
          </Button>
        </div>
      </section>

      {showCreate && (
        <div className="online-modal">
          <button className="online-modal__backdrop" onClick={() => setShowCreate(false)} aria-label="Fechar" />
          <form
            className="online-modal__panel"
            onSubmit={(event) => {
              event.preventDefault()
              void createRoom()
            }}
          >
            <div>
              <strong>Criar sala</strong>
              <p>Defina as regras básicas do lobby.</p>
            </div>

            <label>
              Nome da sala
              <input value={form.name} maxLength={40} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>

            <label>
              Limite de jogadores
              <select value={form.maxPlayers} onChange={(event) => setForm({ ...form, maxPlayers: Number(event.target.value) })}>
                {[2, 3, 4, 5, 6, 8, 10, 12, 16].map((value) => (
                  <option key={value} value={value}>{value} jogadores</option>
                ))}
              </select>
            </label>

            <label className="online-check">
              <input type="checkbox" checked={form.private} onChange={(event) => setForm({ ...form, private: event.target.checked })} />
              Sala privada
            </label>

            {form.private && (
              <label>
                Senha
                <input type="password" value={form.password} maxLength={60} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
              </label>
            )}

            <div className="online-modal__actions">
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button type="submit" disabled={creating}>{creating ? 'Criando...' : 'Criar sala'}</Button>
            </div>
          </form>
        </div>
      )}

      {joinRoom && (
        <div className="online-modal">
          <button className="online-modal__backdrop" onClick={() => setJoinRoom(null)} aria-label="Fechar" />
          <form
            className="online-modal__panel"
            onSubmit={(event) => {
              event.preventDefault()
              void joinSelectedRoom(joinRoom)
            }}
          >
            <strong>Entrar em {joinRoom.name}</strong>
            <p>Esta sala precisa de uma senha.</p>
            <label>
              Senha
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            </label>
            <div className="online-modal__actions">
              <Button type="button" variant="secondary" onClick={() => setJoinRoom(null)}>Cancelar</Button>
              <Button type="submit" disabled={joining || !password.trim()}>{joining ? 'Entrando...' : 'Entrar'}</Button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
