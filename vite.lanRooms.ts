import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

interface LanPlayer {
  id: string
  name: string
  host: boolean
  ready: boolean
  teamSize: number
  teamPokemonIds: number[]
  lastSeen: number
}

interface LanRoom {
  id: string
  name: string
  code: string
  hostId: string
  maxPlayers: number
  private: boolean
  password?: string
  status: 'waiting' | 'battle'
  players: LanPlayer[]
  createdAt: number
}

const ROOM_TTL_MS = 6 * 60 * 60 * 1000
const PLAYER_STALE_MS = 30_000

function json(response: ServerResponse, data: unknown, status = 200): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(data))
}

function cleanName(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

function normalizeLimit(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.max(2, Math.min(16, Math.floor(number)))
    : 4
}

function makeCode(rooms: LanRoom[]): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = ''
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)]
    }

    if (!rooms.some((room) => room.code === code)) return code
  }

  return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
}

function activePlayers(room: LanRoom, now: number): LanPlayer[] {
  return room.players.filter((player) => now - player.lastSeen <= PLAYER_STALE_MS)
}

function pruneRooms(rooms: LanRoom[]): LanRoom[] {
  const now = Date.now()
  const activeRooms: LanRoom[] = []

  for (const room of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) continue

    room.players = activePlayers(room, now)

    if (room.players.length === 0) continue

    if (!room.players.some((player) => player.id === room.hostId)) {
      room.hostId = room.players[0].id
      for (const player of room.players) {
        player.host = player.id === room.hostId
      }
    }

    activeRooms.push(room)
  }

  return activeRooms
}

function publicRoom(room: LanRoom) {
  return {
    id: room.id,
    name: room.name,
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    private: room.private,
    status: room.status,
    players: room.players.map(({ id, name, host, ready, teamSize, lastSeen }) => ({
      id,
      name,
      host,
      ready,
      teamSize,
      lastSeen,
    })),
    createdAt: room.createdAt,
  }
}

function findRoom(rooms: LanRoom[], body: { roomId?: string; code?: string }): LanRoom | undefined {
  if (body.roomId) return rooms.find((room) => room.id === body.roomId)

  const code = body.code?.trim().toUpperCase()
  if (!code) return undefined

  return rooms.find((room) => room.code === code)
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  let size = 0

  for await (const chunk of request) {
    const text = typeof chunk === 'string' ? chunk : chunk.toString()
    size += Buffer.byteLength(text)

    if (size > 256 * 1024) {
      throw new Error('Corpo da requisição muito grande.')
    }

    body += text
  }

  if (!body) return {}

  const parsed = JSON.parse(body)
  return parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : {}
}

function normalizeTeam(value: unknown): number[] {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value
        .filter((id): id is number => Number.isInteger(id) && id > 0)
        .slice(0, 6),
    ),
  )
}

function handleLanRooms(): Connect.HandleFunction {
  const rooms: LanRoom[] = []

  return async (request, response, next) => {
    try {
      if (request.method === 'OPTIONS') {
        response.statusCode = 204
        response.end()
        return
      }

      const url = new URL(request.url ?? '/', 'http://bymon.lan')
      const roomId = url.searchParams.get('roomId') ?? undefined
      const playerId = url.searchParams.get('playerId') ?? undefined

      if (request.method === 'GET') {
        const activeRooms = pruneRooms(rooms)
        rooms.splice(0, rooms.length, ...activeRooms)

        if (!roomId) {
          json(
            response,
            {
              rooms: activeRooms
                .filter((room) => !room.private && room.status === 'waiting')
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((room) => ({
                  ...publicRoom(room),
                  passwordRequired: room.private,
                })),
            },
          )
          return
        }

        const room = activeRooms.find((entry) => entry.id === roomId)
        if (!room) {
          json(response, { error: 'Sala não encontrada.' }, 404)
          return
        }

        const player = playerId
          ? room.players.find((entry) => entry.id === playerId)
          : undefined

        if (player) player.lastSeen = Date.now()

        json(response, { room: publicRoom(room) })
        return
      }

      if (request.method !== 'POST') {
        json(response, { error: 'Método não suportado.' }, 405)
        return
      }

      const body = await readBody(request)
      const action = body.action

      if (action === 'create') {
        const name = cleanName(body.name, 'Sala sem nome', 40)
        const playerName = cleanName(body.playerName, 'Jogador', 20)
        const maxPlayers = normalizeLimit(body.maxPlayers)
        const privateRoom = Boolean(body.private)
        const password = typeof body.password === 'string' ? body.password.trim() : ''

        if (privateRoom && !password) {
          json(response, { error: 'Salas privadas precisam de uma senha.' }, 400)
          return
        }

        const id = randomUUID()
        const playerId = randomUUID()
        const now = Date.now()

        const room: LanRoom = {
          id,
          name,
          code: makeCode(rooms),
          hostId: playerId,
          maxPlayers,
          private: privateRoom,
          status: 'waiting',
          players: [{
            id: playerId,
            name: playerName,
            host: true,
            ready: false,
            teamSize: 0,
            teamPokemonIds: [],
            lastSeen: now,
          }],
          createdAt: now,
          ...(privateRoom ? { password } : {}),
        }

        rooms.push(room)
        json(response, { room: publicRoom(room), playerId }, 201)
        return
      }

      if (action === 'join') {
        const room = findRoom(pruneRooms(rooms), {
          roomId: typeof body.roomId === 'string' ? body.roomId : undefined,
          code: typeof body.code === 'string' ? body.code : undefined,
        })

        if (!room) {
          json(response, { error: 'Sala não encontrada.' }, 404)
          return
        }

        if (room.status !== 'waiting') {
          json(response, { error: 'A batalha desta sala já começou.' }, 409)
          return
        }

        const password = typeof body.password === 'string' ? body.password.trim() : ''
        if (room.private && password !== room.password) {
          json(response, { error: 'Senha incorreta.' }, 403)
          return
        }

        if (room.players.length >= room.maxPlayers) {
          json(response, { error: 'A sala está cheia.' }, 409)
          return
        }

        const playerId = randomUUID()
        room.players.push({
          id: playerId,
          name: cleanName(body.playerName, 'Jogador', 20),
          host: false,
          ready: false,
          teamSize: 0,
          teamPokemonIds: [],
          lastSeen: Date.now(),
        })

        json(response, { room: publicRoom(room), playerId })
        return
      }

      if (
        action !== 'heartbeat' &&
        action !== 'team' &&
        action !== 'ready' &&
        action !== 'leave'
      ) {
        json(response, { error: 'Ação inválida.' }, 400)
        return
      }

      const targetRoomId = typeof body.roomId === 'string' ? body.roomId : ''
      const targetPlayerId = typeof body.playerId === 'string' ? body.playerId : ''
      const room = pruneRooms(rooms).find((entry) => entry.id === targetRoomId)

      if (!room) {
        json(response, { error: 'Sala não encontrada.' }, 404)
        return
      }

      const player = room.players.find((entry) => entry.id === targetPlayerId)
      if (!player) {
        json(response, { error: 'Jogador não está na sala.' }, 403)
        return
      }

      player.lastSeen = Date.now()

      if (action === 'team') {
        player.teamPokemonIds = normalizeTeam(body.teamPokemonIds)
        player.teamSize = player.teamPokemonIds.length
        player.ready = false
      }

      if (action === 'ready') {
        const ready = Boolean(body.ready)
        if (ready && player.teamPokemonIds.length === 0) {
          json(response, { error: 'Monte seu time antes de ficar pronto.' }, 400)
          return
        }

        player.ready = ready

        if (
          ready &&
          room.players.length >= 2 &&
          room.players.every((entry) => entry.ready && entry.teamPokemonIds.length > 0)
        ) {
          room.status = 'battle'
        }
      }

      if (action === 'leave') {
        room.players = room.players.filter((entry) => entry.id !== targetPlayerId)

        if (room.players.length === 0) {
          const index = rooms.findIndex((entry) => entry.id === room.id)
          if (index >= 0) rooms.splice(index, 1)

          json(response, { left: true })
          return
        }

        if (!room.players.some((entry) => entry.id === room.hostId)) {
          room.hostId = room.players[0].id
          for (const entry of room.players) {
            entry.host = entry.id === room.hostId
          }
        }
      }

      json(response, { room: publicRoom(room) })
    } catch (error) {
      if (error instanceof SyntaxError) {
        json(response, { error: 'JSON inválido.' }, 400)
        return
      }

      console.error('[ByMon LAN]', error)
      json(
        response,
        { error: error instanceof Error ? error.message : 'Servidor LAN indisponível.' },
        500,
      )
    }

    void next
  }
}

export function bymonLanRoomsPlugin(): Plugin {
  return {
    name: 'bymon-lan-rooms',
    configureServer(server) {
      server.middlewares.use('/api/lan', handleLanRooms())
    },
  }
}
