import { createHash, randomUUID } from 'node:crypto'
import { createClient } from 'redis'
import type { OnlinePlayer, OnlineRoom, OnlineRoomStatus } from '../src/types/online'

const ROOM_TTL_SECONDS = 60 * 60 * 6
const PLAYER_STALE_MS = 30_000
const SIGNAL_TTL_SECONDS = 60
const MAX_SIGNAL_BYTES = 64 * 1024
const ROOM_PREFIX = 'bymon:room:'
const ROOM_CODE_PREFIX = 'bymon:room-code:'
const PUBLIC_ROOMS_KEY = 'bymon:rooms:public'
const SIGNAL_PREFIX = 'bymon:signal:'

interface CreateBody {
  action: 'create'
  name: string
  maxPlayers: number
  private?: boolean
  password?: string
  playerName: string
}

interface JoinBody {
  action: 'join'
  roomId?: string
  code?: string
  password?: string
  playerName: string
}

interface PlayerBody {
  action: 'heartbeat' | 'leave' | 'status'
  roomId: string
  playerId: string
  sessionToken: string
  status?: OnlineRoomStatus
}

interface SignalSendBody {
  action: 'signal-send'
  roomId: string
  playerId: string
  sessionToken: string
  targetPlayerId: string
  signalType: 'offer' | 'answer' | 'ice-candidate'
  data: unknown
}

interface SignalPullBody {
  action: 'signal-pull'
  roomId: string
  playerId: string
  sessionToken: string
}

type Body = CreateBody | JoinBody | PlayerBody | SignalSendBody | SignalPullBody

type StoredPlayer = OnlinePlayer & {
  sessionToken: string
  lastSeen: number
}

type StoredRoom = Omit<OnlineRoom, 'players'> & {
  players: StoredPlayer[]
  passwordHash?: string
}

declare global {
  var __bymonRedis: Promise<ReturnType<typeof createClient>> | undefined
}

function getRedis(): Promise<ReturnType<typeof createClient>> {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL não configurada.')
  }

  if (!globalThis.__bymonRedis) {
    const client = createClient({ url: process.env.REDIS_URL })

    client.on('error', (error) => {
      console.error('Redis:', error)
    })

    globalThis.__bymonRedis = client.connect().then(() => client)
  }

  return globalThis.__bymonRedis
}

function roomKey(id: string): string {
  return ROOM_PREFIX + id
}

function codeKey(code: string): string {
  return ROOM_CODE_PREFIX + code
}

function signalKey(roomId: string, playerId: string): string {
  return SIGNAL_PREFIX + roomId + ':' + playerId
}

function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex')
}

function cleanName(value: unknown, fallback: string, maxLength: number): string {
  const valueString = typeof value === 'string' ? value.trim() : ''
  return (valueString || fallback).slice(0, maxLength)
}

function normalizeLimit(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return 4
  return Math.max(2, Math.min(16, Math.floor(number)))
}

function makeCode(): string {
  return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}

function isActive(player: StoredPlayer, now: number): boolean {
  return now - player.lastSeen <= PLAYER_STALE_MS
}

function pruneRoom(room: StoredRoom, now: number): StoredRoom {
  room.players = room.players.filter((player) => isActive(player, now))
  return room
}

function hostIsActive(room: StoredRoom): boolean {
  return room.players.some((player) => player.id === room.hostId && player.host)
}

function publicRoom(room: StoredRoom): OnlineRoom {
  return {
    id: room.id,
    name: room.name,
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    private: room.private,
    status: room.status,
    players: room.players.map(({ id, name, host, lastSeen }) => ({
      id,
      name,
      host,
      ready: false,
      teamSize: 0,
      lastSeen,
    })),
    createdAt: room.createdAt,
  }
}

async function deleteRoom(
  redis: ReturnType<typeof createClient>,
  room: StoredRoom,
): Promise<void> {
  await redis.multi()
    .del(roomKey(room.id))
    .del(codeKey(room.code))
    .sRem(PUBLIC_ROOMS_KEY, room.id)
    .exec()

  await Promise.all(
    room.players.map((player) => redis.del(signalKey(room.id, player.id))),
  )
}

async function findRoomId(
  redis: ReturnType<typeof createClient>,
  body: JoinBody,
): Promise<string | null> {
  if (body.roomId) return body.roomId
  if (!body.code) return null
  return redis.get(codeKey(body.code.trim().toUpperCase()))
}

async function listRooms(redis: ReturnType<typeof createClient>): Promise<Response> {
  const ids = await redis.sMembers(PUBLIC_ROOMS_KEY)
  const rooms: RoomListItem[] = []
  const now = Date.now()

  for (const id of ids) {
    const raw = await redis.get(roomKey(id))

    if (!raw) {
      await redis.sRem(PUBLIC_ROOMS_KEY, id)
      continue
    }

    const room = pruneRoom(JSON.parse(raw) as StoredRoom, now)

    if (!hostIsActive(room)) {
      await deleteRoom(redis, room)
      continue
    }

    await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })

    if (room.status === 'waiting') {
      rooms.push({
        ...publicRoom(room),
        passwordRequired: room.private,
      })
    }
  }

  rooms.sort((a, b) => b.createdAt - a.createdAt)
  return json({ rooms })
}

async function createRoom(
  redis: ReturnType<typeof createClient>,
  body: CreateBody,
): Promise<Response> {
  const name = cleanName(body.name, 'Sala sem nome', 40)
  const playerName = cleanName(body.playerName, 'Jogador', 20)
  const maxPlayers = normalizeLimit(body.maxPlayers)
  const privateRoom = Boolean(body.private)

  if (privateRoom && !body.password?.trim()) {
    return json({ error: 'Salas privadas precisam de uma senha.' }, 400)
  }

  let id = randomUUID()
  let code = makeCode()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const exists = await redis.exists(roomKey(id))
    const codeExists = await redis.get(codeKey(code))

    if (!exists && !codeExists) break

    id = randomUUID()
    code = makeCode()
  }

  const now = Date.now()
  const playerId = randomUUID()
  const sessionToken = randomUUID()

  const host: StoredPlayer = {
    id: playerId,
    name: playerName,
    host: true,
    sessionToken,
    lastSeen: now,
  }

  const room: StoredRoom = {
    id,
    name,
    code,
    hostId: playerId,
    maxPlayers,
    private: privateRoom,
    status: 'waiting',
    players: [host],
    createdAt: now,
    ...(privateRoom ? { passwordHash: hashPassword(body.password!.trim()) } : {}),
  }

  await redis.multi()
    .set(roomKey(id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })
    .set(codeKey(code), id, { EX: ROOM_TTL_SECONDS })
    .sAdd(PUBLIC_ROOMS_KEY, id)
    .exec()

  if (privateRoom) {
    await redis.sRem(PUBLIC_ROOMS_KEY, id)
  }

  return json(
    {
      room: publicRoom(room),
      playerId,
      sessionToken,
    },
    201,
  )
}

async function joinRoom(
  redis: ReturnType<typeof createClient>,
  body: JoinBody,
): Promise<Response> {
  const id = await findRoomId(redis, body)

  if (!id) return json({ error: 'Sala não encontrada.' }, 404)

  const raw = await redis.get(roomKey(id))
  if (!raw) return json({ error: 'Sala não encontrada.' }, 404)

  const room = pruneRoom(JSON.parse(raw) as StoredRoom, Date.now())

  if (!hostIsActive(room)) {
    await deleteRoom(redis, room)
    return json({ error: 'O host da sala ficou offline.' }, 410)
  }

  if (room.status !== 'waiting') {
    return json({ error: 'A batalha desta sala já começou.' }, 409)
  }

  if (room.private && hashPassword(body.password ?? '') !== room.passwordHash) {
    return json({ error: 'Senha incorreta.' }, 403)
  }

  if (room.players.length >= room.maxPlayers) {
    return json({ error: 'A sala está cheia.' }, 409)
  }

  const playerId = randomUUID()
  const sessionToken = randomUUID()

  room.players.push({
    id: playerId,
    name: cleanName(body.playerName, 'Jogador', 20),
    host: false,
    sessionToken,
    lastSeen: Date.now(),
  })

  await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })

  return json({
    room: publicRoom(room),
    playerId,
    sessionToken,
  })
}

async function getAuthenticatedRoomPlayer(
  redis: ReturnType<typeof createClient>,
  roomId: string,
  playerId: string,
  sessionToken: string,
): Promise<{ room: StoredRoom; player: StoredPlayer } | null> {
  const raw = await redis.get(roomKey(roomId))
  if (!raw) return null

  const room = pruneRoom(JSON.parse(raw) as StoredRoom, Date.now())
  if (!hostIsActive(room)) {
    await deleteRoom(redis, room)
    return null
  }

  const player = room.players.find(
    (entry) => entry.id === playerId && entry.sessionToken === sessionToken,
  )

  if (!player) return null

  player.lastSeen = Date.now()
  await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })

  return { room, player }
}

async function getRoom(
  redis: ReturnType<typeof createClient>,
  roomId: string,
  playerId: string,
  sessionToken: string,
): Promise<Response> {
  const authenticated = await getAuthenticatedRoomPlayer(redis, roomId, playerId, sessionToken)
  if (!authenticated) {
    return json({ error: 'Sala ou sessão inválida.' }, 403)
  }

  return json({ room: publicRoom(authenticated.room) })
}

async function updatePlayer(
  redis: ReturnType<typeof createClient>,
  body: PlayerBody,
): Promise<Response> {
  const authenticated = await getAuthenticatedRoomPlayer(
    redis,
    body.roomId,
    body.playerId,
    body.sessionToken,
  )

  if (!authenticated) {
    return json({ error: 'Sala ou sessão inválida.' }, 403)
  }

  const { room } = authenticated

  if (body.action === 'status') {
    if (body.playerId !== room.hostId) {
      return json({ error: 'Somente o host pode alterar o status da sala.' }, 403)
    }

    if (body.status !== 'waiting' && body.status !== 'battle') {
      return json({ error: 'Status de sala inválido.' }, 400)
    }

    room.status = body.status
    await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })
    return json({ room: publicRoom(room) })
  }

  if (body.action === 'heartbeat') {
    return json({ room: publicRoom(room) })
  }

  if (body.playerId === room.hostId) {
    await deleteRoom(redis, room)
    return json({ left: true, roomClosed: true })
  }

  room.players = room.players.filter((entry) => entry.id !== body.playerId)
  await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })
  await redis.del(signalKey(room.id, body.playerId))

  return json({ left: true, room: publicRoom(room) })
}

async function sendSignal(
  redis: ReturnType<typeof createClient>,
  body: SignalSendBody,
): Promise<Response> {
  const authenticated = await getAuthenticatedRoomPlayer(
    redis,
    body.roomId,
    body.playerId,
    body.sessionToken,
  )

  if (!authenticated) {
    return json({ error: 'Sala ou sessão inválida.' }, 403)
  }

  const target = authenticated.room.players.find(
    (player) => player.id === body.targetPlayerId,
  )

  if (!target) {
    return json({ error: 'Jogador de destino não está na sala.' }, 404)
  }

  if (!['offer', 'answer', 'ice-candidate'].includes(body.signalType)) {
    return json({ error: 'Sinal WebRTC inválido.' }, 400)
  }

  let serializedData: string

  try {
    serializedData = JSON.stringify(body.data)
  } catch {
    return json({ error: 'Sinal WebRTC inválido.' }, 400)
  }

  if (new TextEncoder().encode(serializedData).byteLength > MAX_SIGNAL_BYTES) {
    return json({ error: 'Sinal WebRTC excede o limite permitido.' }, 413)
  }

  const message = JSON.stringify({
    fromPlayerId: body.playerId,
    signalType: body.signalType,
    data: body.data,
    createdAt: Date.now(),
  })

  const key = signalKey(body.roomId, body.targetPlayerId)
  await redis.rPush(key, message)
  await redis.expire(key, SIGNAL_TTL_SECONDS)

  return json({ queued: true })
}

async function pullSignals(
  redis: ReturnType<typeof createClient>,
  body: SignalPullBody,
): Promise<Response> {
  const authenticated = await getAuthenticatedRoomPlayer(
    redis,
    body.roomId,
    body.playerId,
    body.sessionToken,
  )

  if (!authenticated) {
    return json({ error: 'Sala ou sessão inválida.' }, 403)
  }

  const key = signalKey(body.roomId, body.playerId)
  // LPOP com contagem remove apenas os sinais lidos numa operação atômica.
  // LRANGE seguido de DEL poderia apagar sinais recebidos entre as duas chamadas.
  const rawSignals = await redis.lPopCount(key, 64)
  const signals = (rawSignals ?? [])
    .map((entry) => {
      try {
        return JSON.parse(entry)
      } catch {
        return null
      }
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))

  return json({ signals })
}

async function handle(request: Request): Promise<Response> {
  try {
    const redis = await getRedis()

    if (request.method === 'GET') {
      const url = new URL(request.url)
      const roomId = url.searchParams.get('roomId')
      const playerId = url.searchParams.get('playerId')
      const sessionToken = url.searchParams.get('sessionToken')

      if (roomId && playerId && sessionToken) {
        return getRoom(redis, roomId, playerId, sessionToken)
      }

      return listRooms(redis)
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as Body
      if (!body.action) return json({ error: 'Ação inválida.' }, 400)

      if (body.action === 'create') return createRoom(redis, body)
      if (body.action === 'join') return joinRoom(redis, body)

      if (
        body.action === 'heartbeat' ||
        body.action === 'leave' ||
        body.action === 'status'
      ) {
        return updatePlayer(redis, body)
      }

      if (body.action === 'signal-send') return sendSignal(redis, body)
      if (body.action === 'signal-pull') return pullSignals(redis, body)
    }

    return json({ error: 'Método não suportado.' }, 405)
  } catch (error) {
    console.error(error)

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Servidor online indisponível.',
      },
      500,
    )
  }
}

export default { fetch: handle }