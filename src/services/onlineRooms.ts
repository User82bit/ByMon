import type { OnlinePlayer, OnlineRoom, RoomListItem, RoomSession } from '../types/online'

const API_URL = import.meta.env.VITE_ONLINE_API_URL?.trim() ?? ''
const LOCAL_STORAGE_KEY = 'bymon-online-local-rooms'
const ROOM_TTL_MS = 6 * 60 * 60 * 1000
const PLAYER_STALE_MS = 30_000

export const ONLINE_LOCAL_MODE = API_URL.length === 0

type LocalPlayer = OnlinePlayer & {
  teamPokemonIds: number[]
}

type LocalRoom = Omit<OnlineRoom, 'players'> & {
  players: LocalPlayer[]
  password?: string
}

function id(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function publicRoom(room: LocalRoom): OnlineRoom {
  return {
    id: room.id,
    name: room.name,
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    private: room.private,
    status: room.status,
    players: room.players.map(({ id: playerId, name, host, ready, teamSize, lastSeen }) => ({
      id: playerId,
      name,
      host,
      ready,
      teamSize,
      lastSeen,
    })),
    createdAt: room.createdAt,
  }
}

function readLocalRooms(): LocalRoom[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as LocalRoom[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeLocalRooms(rooms: LocalRoom[]): void {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(rooms))
}

function pruneLocalRooms(): LocalRoom[] {
  const now = Date.now()
  const rooms = readLocalRooms()
  const activeRooms: LocalRoom[] = []

  for (const room of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) continue

    const players = room.players.filter((player) => now - player.lastSeen <= PLAYER_STALE_MS)
    if (players.length === 0) continue

    const host = players.find((player) => player.id === room.hostId)
    if (!host) {
      players[0].host = true
      room.hostId = players[0].id
    }

    room.players = players
    activeRooms.push(room)
  }

  writeLocalRooms(activeRooms)
  return activeRooms
}

function findLocalRoom(rooms: LocalRoom[], input: { roomId?: string; code?: string }): LocalRoom | undefined {
  if (input.roomId) return rooms.find((room) => room.id === input.roomId)

  const code = input.code?.trim().toUpperCase()
  if (!code) return undefined

  return rooms.find((room) => room.code === code)
}

function makeLocalCode(rooms: LocalRoom[]): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = ''
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)]
    }

    if (!rooms.some((room) => room.code === code)) return code
  }

  return id().replace(/-/g, '').slice(0, 6).toUpperCase()
}

function localName(value: string | undefined, fallback: string, maxLength: number): string {
  return (value?.trim() || fallback).slice(0, maxLength)
}

function localLimit(value: number): number {
  return Math.max(2, Math.min(16, Math.floor(Number(value) || 4)))
}

function localCreateRoom(input: {
  name: string
  maxPlayers: number
  private: boolean
  password?: string
  playerName: string
}): RoomSession {
  const rooms = pruneLocalRooms()
  const roomId = id()
  const playerId = id()
  const now = Date.now()

  const room: LocalRoom = {
    id: roomId,
    name: localName(input.name, 'Sala sem nome', 40),
    code: makeLocalCode(rooms),
    hostId: playerId,
    maxPlayers: localLimit(input.maxPlayers),
    private: Boolean(input.private),
    status: 'waiting',
    players: [{
      id: playerId,
      name: localName(input.playerName, 'Jogador', 20),
      host: true,
      ready: false,
      teamSize: 0,
      teamPokemonIds: [],
      lastSeen: now,
    }],
    createdAt: now,
    ...(input.private ? { password: input.password?.trim() ?? '' } : {}),
  }

  rooms.push(room)
  writeLocalRooms(rooms)

  return {
    room: publicRoom(room),
    playerId,
  }
}

function localJoinRoom(input: {
  roomId?: string
  code?: string
  password?: string
  playerName: string
}): RoomSession {
  const rooms = pruneLocalRooms()
  const room = findLocalRoom(rooms, input)

  if (!room) throw new Error('Sala não encontrada.')
  if (room.status !== 'waiting') throw new Error('A batalha desta sala já começou.')
  if (room.private && (input.password ?? '') !== (room.password ?? '')) {
    throw new Error('Senha incorreta.')
  }
  if (room.players.length >= room.maxPlayers) {
    throw new Error('A sala está cheia.')
  }

  const playerId = id()
  room.players.push({
    id: playerId,
    name: localName(input.playerName, 'Jogador', 20),
    host: false,
    ready: false,
    teamSize: 0,
    teamPokemonIds: [],
    lastSeen: Date.now(),
  })

  writeLocalRooms(rooms)

  return {
    room: publicRoom(room),
    playerId,
  }
}

function localGetRoom(roomId: string, playerId: string): OnlineRoom {
  const rooms = pruneLocalRooms()
  const room = rooms.find((entry) => entry.id === roomId)

  if (!room) throw new Error('Sala não encontrada.')

  const player = room.players.find((entry) => entry.id === playerId)
  if (!player) throw new Error('Jogador não está na sala.')

  player.lastSeen = Date.now()
  writeLocalRooms(rooms)

  return publicRoom(room)
}

function localSetTeam(roomId: string, playerId: string, teamPokemonIds: number[]): OnlineRoom {
  const rooms = pruneLocalRooms()
  const room = rooms.find((entry) => entry.id === roomId)

  if (!room) throw new Error('Sala não encontrada.')

  const player = room.players.find((entry) => entry.id === playerId)
  if (!player) throw new Error('Jogador não está na sala.')

  const uniqueIds = Array.from(
    new Set(
      teamPokemonIds
        .filter((pokemonId) => Number.isInteger(pokemonId) && pokemonId > 0)
        .slice(0, 6),
    ),
  )

  player.teamPokemonIds = uniqueIds
  player.teamSize = uniqueIds.length
  player.ready = false
  player.lastSeen = Date.now()

  writeLocalRooms(rooms)
  return publicRoom(room)
}

function localSetReady(roomId: string, playerId: string, ready: boolean): OnlineRoom {
  const rooms = pruneLocalRooms()
  const room = rooms.find((entry) => entry.id === roomId)

  if (!room) throw new Error('Sala não encontrada.')

  const player = room.players.find((entry) => entry.id === playerId)
  if (!player) throw new Error('Jogador não está na sala.')

  if (ready && player.teamPokemonIds.length === 0) {
    throw new Error('Monte seu time antes de ficar pronto.')
  }

  player.ready = ready
  player.lastSeen = Date.now()

  if (
    ready &&
    room.players.length >= 2 &&
    room.players.every((entry) => entry.ready && entry.teamPokemonIds.length > 0)
  ) {
    room.status = 'battle'
  }

  writeLocalRooms(rooms)
  return publicRoom(room)
}

function localLeaveRoom(roomId: string, playerId: string): void {
  const rooms = pruneLocalRooms()
  const room = rooms.find((entry) => entry.id === roomId)
  if (!room) return

  room.players = room.players.filter((entry) => entry.id !== playerId)

  if (room.players.length === 0) {
    writeLocalRooms(rooms.filter((entry) => entry.id !== roomId))
    return
  }

  if (!room.players.some((entry) => entry.id === room.hostId)) {
    room.hostId = room.players[0].id
    room.players[0].host = true
  }

  writeLocalRooms(rooms)
}

async function request<T>(input: RequestInit = {}, query = ''): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(API_URL + query, {
      ...input,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(input.headers ?? {}),
      },
    })

    const text = await response.text()
    let data: (T & { error?: string }) | null = null

    try {
      data = text ? (JSON.parse(text) as T & { error?: string }) : null
    } catch {
      throw new Error('O servidor online retornou uma resposta inválida.')
    }

    if (!response.ok) {
      throw new Error(data?.error ?? 'Falha na comunicação com o servidor.')
    }

    if (!data) throw new Error('O servidor online não retornou dados.')
    return data
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('O servidor online não respondeu.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function listOnlineRooms(): Promise<RoomListItem[]> {
  if (ONLINE_LOCAL_MODE) {
    return pruneLocalRooms()
      .filter((room) => !room.private && room.status === 'waiting')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => ({
        ...publicRoom(room),
        passwordRequired: room.private,
      }))
  }

  const data = await request<{ rooms: RoomListItem[] }>()
  return data.rooms
}

export async function createOnlineRoom(input: {
  name: string
  maxPlayers: number
  private: boolean
  password?: string
  playerName: string
}): Promise<RoomSession> {
  if (ONLINE_LOCAL_MODE) return localCreateRoom(input)

  return request<RoomSession>({
    method: 'POST',
    body: JSON.stringify({ action: 'create', ...input }),
  })
}

export async function joinOnlineRoom(input: {
  roomId?: string
  code?: string
  password?: string
  playerName: string
}): Promise<RoomSession> {
  if (ONLINE_LOCAL_MODE) return localJoinRoom(input)

  return request<RoomSession>({
    method: 'POST',
    body: JSON.stringify({ action: 'join', ...input }),
  })
}

export async function getOnlineRoom(
  roomId: string,
  playerId: string,
): Promise<OnlineRoom> {
  if (ONLINE_LOCAL_MODE) return localGetRoom(roomId, playerId)

  const data = await request<{ room: OnlineRoom }>(
    undefined,
    '?roomId=' + encodeURIComponent(roomId) + '&playerId=' + encodeURIComponent(playerId),
  )
  return data.room
}

export async function setOnlinePlayerTeam(
  roomId: string,
  playerId: string,
  teamPokemonIds: number[],
): Promise<OnlineRoom> {
  if (ONLINE_LOCAL_MODE) {
    return localSetTeam(roomId, playerId, teamPokemonIds)
  }

  const data = await request<{ room: OnlineRoom }>({
    method: 'POST',
    body: JSON.stringify({
      action: 'team',
      roomId,
      playerId,
      teamPokemonIds,
    }),
  })

  return data.room
}

export async function setOnlinePlayerReady(
  roomId: string,
  playerId: string,
  ready: boolean,
): Promise<OnlineRoom> {
  if (ONLINE_LOCAL_MODE) {
    return localSetReady(roomId, playerId, ready)
  }

  const data = await request<{ room: OnlineRoom }>({
    method: 'POST',
    body: JSON.stringify({
      action: 'ready',
      roomId,
      playerId,
      ready,
    }),
  })

  return data.room
}

export async function leaveOnlineRoom(roomId: string, playerId: string): Promise<void> {
  if (ONLINE_LOCAL_MODE) {
    localLeaveRoom(roomId, playerId)
    return
  }

  await request({
    method: 'POST',
    body: JSON.stringify({
      action: 'leave',
      roomId,
      playerId,
    }),
  })
}
