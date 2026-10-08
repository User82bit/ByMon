import type { OnlinePlayer, OnlineRoom, RoomListItem, RoomSession } from '../types/online'

const CONFIGURED_API_URL = import.meta.env.VITE_ONLINE_API_URL?.trim() ?? ''
const LAN_API_URL = '/api/lan'
const configuredApiUrl = import.meta.env.VITE_ONLINE_API_URL?.trim() ?? ''

function isPrivateNetworkHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false
  if (hostname.endsWith('.local')) return true

  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return false

  const [first, second] = octets
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
}

const API_URL = configuredApiUrl ||
  (isPrivateNetworkHostname(window.location.hostname) ? '/api/lan' : '')

export const ONLINE_LAN_MODE = API_URL === '/api/lan'
export const ONLINE_LOCAL_MODE = API_URL === ''
const LOCAL_STORAGE_KEY = 'bymon-online-local-rooms'
const ROOM_TTL_MS = 6 * 60 * 60 * 1000
const PLAYER_STALE_MS = 30_000

export type OnlineMode = 'local' | 'lan' | 'server'

let resolvedMode: OnlineMode | null = CONFIGURED_API_URL ? 'server' : null

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

function publicLocalRoom(room: LocalRoom): OnlineRoom {
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

    if (!players.some((player) => player.id === room.hostId)) {
      players[0].host = true
      room.hostId = players[0].id
    }

    room.players = players
    activeRooms.push(room)
  }

  writeLocalRooms(activeRooms)
  return activeRooms
}

function findLocalRoom(
  rooms: LocalRoom[],
  input: { roomId?: string; code?: string },
): LocalRoom | undefined {
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
    room: publicLocalRoom(room),
    playerId,
    source: 'local',
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
    room: publicLocalRoom(room),
    playerId,
    source: 'local',
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

  return publicLocalRoom(room)
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
  return publicLocalRoom(room)
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
  return publicLocalRoom(room)
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

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8_000,
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
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

export async function getOnlineMode(): Promise<OnlineMode> {
  if (resolvedMode) return resolvedMode

  try {
    const data = await fetchJson<{ available?: boolean; mode?: string }>(
      LAN_API_URL + '/status',
      {},
      2_000,
    )

    if (data.available && data.mode === 'lan') {
      resolvedMode = 'lan'
      return resolvedMode
    }
  } catch {
    // A ausência do serviço LAN significa somente que o modo local será usado.
  }

  resolvedMode = 'local'
  return resolvedMode
}

async function triggerLanDiscovery(): Promise<void> {
  await fetchJson<{ ok: boolean }>(
    LAN_API_URL + '/discover',
    { method: 'POST', body: JSON.stringify({}) },
    2_000,
  ).catch(() => ({ ok: false }))

  await new Promise((resolve) => window.setTimeout(resolve, 120))
}

async function listLanRooms(): Promise<RoomListItem[]> {
  await triggerLanDiscovery()

  const data = await fetchJson<{ rooms: RoomListItem[] }>(
    LAN_API_URL + '/discovery',
  )

  return data.rooms.map((room) => ({
    ...room,
    source: 'lan',
  }))
}

export async function listOnlineRooms(): Promise<RoomListItem[]> {
  const mode = await getOnlineMode()

  if (mode === 'lan') return listLanRooms()

  if (mode === 'local') {
    return pruneLocalRooms()
      .filter((room) => !room.private && room.status === 'waiting')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => ({
        ...publicLocalRoom(room),
        passwordRequired: room.private,
        source: 'local',
      }))
  }

  const data = await fetchJson<{ rooms: RoomListItem[] }>(
    CONFIGURED_API_URL,
  )

  return data.rooms.map((room) => ({
    ...room,
    source: 'server',
  }))
}

export async function createOnlineRoom(input: {
  name: string
  maxPlayers: number
  private: boolean
  password?: string
  playerName: string
}): Promise<RoomSession> {
  const mode = await getOnlineMode()

  if (mode === 'lan') {
    return fetchJson<RoomSession>(
      LAN_API_URL + '/rooms',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'create', ...input }),
      },
    )
  }

  if (mode === 'local') return localCreateRoom(input)

  const session = await fetchJson<RoomSession>(
    CONFIGURED_API_URL,
    {
      method: 'POST',
      body: JSON.stringify({ action: 'create', ...input }),
    },
  )

  return { ...session, source: 'server' }
}

export async function joinOnlineRoom(input: {
  roomId?: string
  code?: string
  password?: string
  playerName: string
}): Promise<RoomSession> {
  const mode = await getOnlineMode()

  if (mode === 'lan') {
    await triggerLanDiscovery()

    return fetchJson<RoomSession>(
      LAN_API_URL + '/rooms',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'join', ...input }),
      },
    )
  }

  if (mode === 'local') return localJoinRoom(input)

  const session = await fetchJson<RoomSession>(
    CONFIGURED_API_URL,
    {
      method: 'POST',
      body: JSON.stringify({ action: 'join', ...input }),
    },
  )

  return { ...session, source: 'server' }
}

export async function getOnlineRoom(
  roomId: string,
  playerId: string,
): Promise<OnlineRoom> {
  const mode = await getOnlineMode()

  if (mode === 'lan') {
    const data = await fetchJson<{ room: OnlineRoom }>(
      LAN_API_URL + '/rooms',
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'heartbeat',
          roomId,
          playerId,
        }),
      },
    )

    return data.room
  }

  if (mode === 'local') return localGetRoom(roomId, playerId)

  const data = await fetchJson<{ room: OnlineRoom }>(
    CONFIGURED_API_URL +
      '?roomId=' +
      encodeURIComponent(roomId) +
      '&playerId=' +
      encodeURIComponent(playerId),
  )

  return data.room
}

export async function setOnlinePlayerTeam(
  roomId: string,
  playerId: string,
  teamPokemonIds: number[],
): Promise<OnlineRoom> {
  const mode = await getOnlineMode()

  if (mode === 'lan') {
    const data = await fetchJson<{ room: OnlineRoom }>(
      LAN_API_URL + '/rooms',
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'team',
          roomId,
          playerId,
          teamPokemonIds,
        }),
      },
    )

    return data.room
  }

  if (mode === 'local') {
    return localSetTeam(roomId, playerId, teamPokemonIds)
  }

  const data = await fetchJson<{ room: OnlineRoom }>(
    CONFIGURED_API_URL,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'team',
        roomId,
        playerId,
        teamPokemonIds,
      }),
    },
  )

  return data.room
}

export async function setOnlinePlayerReady(
  roomId: string,
  playerId: string,
  ready: boolean,
): Promise<OnlineRoom> {
  const mode = await getOnlineMode()

  if (mode === 'lan') {
    const data = await fetchJson<{ room: OnlineRoom }>(
      LAN_API_URL + '/rooms',
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'ready',
          roomId,
          playerId,
          ready,
        }),
      },
    )

    return data.room
  }

  if (mode === 'local') {
    return localSetReady(roomId, playerId, ready)
  }

  const data = await fetchJson<{ room: OnlineRoom }>(
    CONFIGURED_API_URL,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'ready',
        roomId,
        playerId,
        ready,
      }),
    },
  )

  return data.room
}

export async function leaveOnlineRoom(roomId: string, playerId: string): Promise<void> {
  const mode = await getOnlineMode()

  if (mode === 'lan') {
    await fetchJson(
      LAN_API_URL + '/rooms',
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'leave',
          roomId,
          playerId,
        }),
      },
    )
    return
  }

  if (mode === 'local') {
    localLeaveRoom(roomId, playerId)
    return
  }

  await fetchJson(
    CONFIGURED_API_URL,
    {
      method: 'POST',
      body: JSON.stringify({
        action: 'leave',
        roomId,
        playerId,
      }),
    },
  )
}
