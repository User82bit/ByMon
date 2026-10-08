import { createHash, randomUUID } from 'node:crypto'
import { createClient, type RedisClientType } from 'redis'
import type { OnlinePlayer, OnlineRoom } from '../src/types/online'

const ROOM_TTL_SECONDS = 60 * 60 * 6
const PLAYER_STALE_MS = 30_000
const ROOM_PREFIX = 'bymon:room:'
const PUBLIC_ROOMS_KEY = 'bymon:rooms:public'

type RoomAction = 'create' | 'join' | 'heartbeat' | 'leave' | 'ready'

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
  action: 'heartbeat' | 'leave' | 'ready'
  roomId: string
  playerId: string
  ready?: boolean
}

type Body = CreateBody | JoinBody | PlayerBody

type StoredRoom = OnlineRoom & { passwordHash?: string }

declare global {
  // eslint-disable-next-line no-var
  var __bymonRedis: Promise<RedisClientType> | undefined
}

function getRedis(): Promise<RedisClientType> {
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

function isActive(player: OnlinePlayer, now: number): boolean {
  return now - player.lastSeen <= PLAYER_STALE_MS
}

function prunePlayers(room: OnlineRoom, now: number): OnlineRoom {
  const players = room.players.filter((player) => isActive(player, now))

  if (!players.some((player) => player.id === room.hostId) && players.length > 0) {
    players[0].host = true
    room.hostId = players[0].id
  }

  room.players = players
  return room
}

function publicRoom(room: StoredRoom): Record<string, unknown> {
  return {
    id: room.id,
    name: room.name,
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    private: room.private,
    status: room.status,
    players: room.players.map(({ id, name, host, ready }) => ({ id, name, host, ready })),
    createdAt: room.createdAt,
    passwordRequired: room.private,
  }
}

async function findRoomId(redis: RedisClientType, body: JoinBody): Promise<string | null> {
  if (body.roomId) return body.roomId

  if (!body.code) return null

  const ids = await redis.sMembers(PUBLIC_ROOMS_KEY)
  const candidates = ids.length > 0 ? ids : await redis.keys(ROOM_PREFIX + '*')

  for (const id of candidates) {
    const roomRaw = await redis.get(roomKey(id))
    if (!roomRaw) continue
    const room = JSON.parse(roomRaw) as OnlineRoom
    if (room.code.toUpperCase() === body.code.trim().toUpperCase()) return room.id
  }

  return null
}

async function listRooms(redis: RedisClientType): Promise<Response> {
  const ids = await redis.sMembers(PUBLIC_ROOMS_KEY)
  const rooms: Record<string, unknown>[] = []
  const now = Date.now()

  for (const id of ids) {
    const raw = await redis.get(roomKey(id))

    if (!raw) {
      await redis.sRem(PUBLIC_ROOMS_KEY, id)
      continue
    }

    const room = prunePlayers(JSON.parse(raw) as OnlineRoom, now)

    if (room.status !== 'waiting') continue

    await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })
    rooms.push(publicRoom(room))
  }

  rooms.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
  return json({ rooms })
}

async function createRoom(redis: RedisClientType, body: CreateBody): Promise<Response> {
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
    const codeExists = await redis.get('bymon:room-code:' + code)

    if (!exists && !codeExists) break

    id = randomUUID()
    code = makeCode()
  }

  const now = Date.now()
  const playerId = randomUUID()

  const host: OnlinePlayer = {
    id: playerId,
    name: playerName,
    host: true,
    ready: false,
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
    .set('bymon:room-code:' + code, id, { EX: ROOM_TTL_SECONDS })
    .sAdd(PUBLIC_ROOMS_KEY, id)
    .exec()

  if (privateRoom) {
    await redis.sRem(PUBLIC_ROOMS_KEY, id)
  }

  return json({ room: publicRoom(room), playerId }, 201)
}

async function joinRoom(redis: RedisClientType, body: JoinBody): Promise<Response> {
  const id = await findRoomId(redis, body)

  if (!id) return json({ error: 'Sala não encontrada.' }, 404)

  const raw = await redis.get(roomKey(id))
  if (!raw) return json({ error: 'Sala não encontrada.' }, 404)

  const room = prunePlayers(JSON.parse(raw) as StoredRoom, Date.now())

  if (room.status !== 'waiting') return json({ error: 'A batalha desta sala já começou.' }, 409)
  if (room.private && hashPassword(body.password ?? '') !== room.passwordHash) {
    return json({ error: 'Senha incorreta.' }, 403)
  }

  if (room.players.length >= room.maxPlayers) {
    return json({ error: 'A sala está cheia.' }, 409)
  }

  const playerName = cleanName(body.playerName, 'Jogador', 20)
  const playerId = randomUUID()
  room.players.push({
    id: playerId,
    name: playerName,
    host: false,
    ready: false,
    lastSeen: Date.now(),
  })

  await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })

  return json({ room: publicRoom(room), playerId })
}

async function getRoom(redis: RedisClientType, roomId: string, playerId?: string): Promise<Response> {
  const raw = await redis.get(roomKey(roomId))
  if (!raw) return json({ error: 'Sala não encontrada.' }, 404)

  const room = prunePlayers(JSON.parse(raw) as StoredRoom, Date.now())

  if (playerId) {
    const player = room.players.find((entry) => entry.id === playerId)
    if (player) player.lastSeen = Date.now()
  }

  await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })

  return json({ room: publicRoom(room) })
}

async function updatePlayer(redis: RedisClientType, body: PlayerBody): Promise<Response> {
  const raw = await redis.get(roomKey(body.roomId))
  if (!raw) return json({ error: 'Sala não encontrada.' }, 404)

  const room = prunePlayers(JSON.parse(raw) as OnlineRoom, Date.now())
  const player = room.players.find((entry) => entry.id === body.playerId)

  if (!player) return json({ error: 'Jogador não está na sala.' }, 403)

  if (body.action === 'ready') {
    player.ready = Boolean(body.ready)
  }

  player.lastSeen = Date.now()

  if (body.action === 'leave') {
    room.players = room.players.filter((entry) => entry.id !== body.playerId)

    if (body.playerId === room.hostId && room.players.length > 0) {
      room.players[0].host = true
      room.hostId = room.players[0].id
    }

    if (room.players.length === 0) {
      await redis.del(roomKey(room.id))
      await redis.sRem(PUBLIC_ROOMS_KEY, room.id)
      await redis.del('bymon:room-code:' + room.code)
      return json({ left: true })
    }
  }

  await redis.set(roomKey(room.id), JSON.stringify(room), { EX: ROOM_TTL_SECONDS })

  return json({ room: publicRoom(room) })
}

export default async function handler(request: Request): Promise<Response> {
  try {
    const redis = await getRedis()

    if (request.method === 'GET') {
      const url = new URL(request.url)
      const roomId = url.searchParams.get('roomId')
      const playerId = url.searchParams.get('playerId')

      if (roomId) {
        return getRoom(redis, roomId, playerId ?? undefined)
      }

      return listRooms(redis)
    }

    if (request.method === 'POST') {
      const body = (await request.json()) as Body
      if (!body.action) return json({ error: 'Ação inválida.' }, 400)

      if (body.action === 'create') return createRoom(redis, body)
      if (body.action === 'join') return joinRoom(redis, body)
      if (body.action === 'heartbeat' || body.action === 'leave' || body.action === 'ready') {
        return updatePlayer(redis, body)
      }
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
