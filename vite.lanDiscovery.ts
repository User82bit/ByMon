import { randomUUID } from 'node:crypto'
import dgram from 'node:dgram'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const DISCOVERY_PORT = 41234
const DISCOVERY_MAGIC = 'BYMON-LAN-1'
const ANNOUNCE_INTERVAL_MS = 2_500
const DISCOVERY_TTL_MS = 9_000

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

interface DiscoveryPacket {
  magic: typeof DISCOVERY_MAGIC
  kind: 'probe' | 'announce' | 'goodbye'
  room?: {
    id: string
    name: string
    code: string
    hostId: string
    maxPlayers: number
    private: boolean
    status: LanRoom['status']
    playerCount: number
    createdAt: number
  }
  port: number
}

interface DiscoveredRoom {
  room: DiscoveryPacket['room']
  address: string
  port: number
  lastSeen: number
}

interface LanState {
  rooms: Map<string, LanRoom>
  discovered: Map<string, DiscoveredRoom>
  socket: dgram.Socket
  announceTimer: NodeJS.Timeout | null
  serverPort: number
}

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
  if (!Number.isFinite(number)) return 4
  return Math.max(2, Math.min(16, Math.floor(number)))
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

function makeCode(rooms: Iterable<LanRoom>): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const existing = new Set(Array.from(rooms, (room) => room.code))

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = ''
    for (let index = 0; index < 6; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)]
    }

    if (!existing.has(code)) return code
  }

  return randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
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
    source: 'lan' as const,
  }
}

function discoveryRoom(room: LanRoom): DiscoveryPacket['room'] {
  return {
    id: room.id,
    name: room.name,
    code: room.code,
    hostId: room.hostId,
    maxPlayers: room.maxPlayers,
    private: room.private,
    status: room.status,
    playerCount: room.players.length,
    createdAt: room.createdAt,
  }
}

function pruneRoom(room: LanRoom): boolean {
  const now = Date.now()

  room.players = room.players.filter(
    (player) => now - player.lastSeen <= 30_000,
  )

  if (room.players.length === 0) return false

  if (!room.players.some((player) => player.id === room.hostId)) {
    room.hostId = room.players[0].id
    for (const player of room.players) {
      player.host = player.id === room.hostId
    }
  }

  return true
}

function pruneState(state: LanState): void {
  for (const [id, room] of state.rooms) {
    if (!pruneRoom(room)) {
      state.rooms.delete(id)
      continue
    }

    if (Date.now() - room.createdAt > 6 * 60 * 60 * 1000) {
      state.rooms.delete(id)
    }
  }

  const now = Date.now()
  for (const [id, entry] of state.discovered) {
    if (
      now - entry.lastSeen > DISCOVERY_TTL_MS ||
      !entry.room ||
      entry.room.status !== 'waiting'
    ) {
      state.discovered.delete(id)
    }
  }
}

function privateIpv4Broadcast(address: string, netmask: string): string | null {
  const parse = (value: string): number | null => {
    const parts = value.split('.').map(Number)
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null
    }

    return (
      (((parts[0] << 24) >>> 0) |
        (parts[1] << 16) |
        (parts[2] << 8) |
        parts[3]) >>> 0
    )
  }

  const ip = parse(address)
  const mask = parse(netmask)

  if (ip === null || mask === null) return null

  const broadcast = (ip | (~mask >>> 0)) >>> 0
  return [
    (broadcast >>> 24) & 255,
    (broadcast >>> 16) & 255,
    (broadcast >>> 8) & 255,
    broadcast & 255,
  ].join('.')
}

function lanBroadcastAddresses(): string[] {
  const addresses = new Set<string>(['255.255.255.255'])

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue

      const broadcast = privateIpv4Broadcast(entry.address, entry.netmask)
      if (broadcast) addresses.add(broadcast)
    }
  }

  return Array.from(addresses)
}

function sendPacket(state: LanState, packet: DiscoveryPacket, target?: { address: string; port: number }): void {
  const payload = Buffer.from(JSON.stringify(packet))

  if (target) {
    state.socket.send(payload, target.port, target.address)
    return
  }

  for (const address of lanBroadcastAddresses()) {
    state.socket.send(payload, DISCOVERY_PORT, address)
  }
}

function announceRoom(state: LanState, room: LanRoom): void {
  sendPacket(state, {
    magic: DISCOVERY_MAGIC,
    kind: 'announce',
    room: discoveryRoom(room),
    port: state.serverPort,
  })
}

function announceAll(state: LanState): void {
  pruneState(state)

  for (const room of state.rooms.values()) {
    announceRoom(state, room)
  }
}

function createSocket(state: LanState): void {
  state.socket.on('message', (buffer, remote) => {
    let packet: DiscoveryPacket

    try {
      packet = JSON.parse(buffer.toString()) as DiscoveryPacket
    } catch {
      return
    }

    if (packet.magic !== DISCOVERY_MAGIC || !packet.port) return

    if (packet.kind === 'probe') {
      for (const room of state.rooms.values()) {
        announceRoom(state, room)
      }
      return
    }

    if (!packet.room) return

    if (packet.kind === 'goodbye') {
      state.discovered.delete(packet.room.id)
      return
    }

    if (packet.kind === 'announce') {
      state.discovered.set(packet.room.id, {
        room: packet.room,
        address: remote.address,
        port: packet.port,
        lastSeen: Date.now(),
      })
    }
  })

  state.socket.on('error', (error) => {
    console.error('[ByMon LAN discovery]', error)
  })

  state.socket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
    try {
      state.socket.setBroadcast(true)
    } catch {
      // Some platforms do not expose broadcast configuration until after bind.
    }

    sendPacket(state, {
      magic: DISCOVERY_MAGIC,
      kind: 'probe',
      port: state.serverPort,
    })
    announceAll(state)
  })
}

function findLocalRoom(state: LanState, input: { roomId?: string; code?: string }): LanRoom | undefined {
  pruneState(state)

  if (input.roomId) return state.rooms.get(input.roomId)

  const code = input.code?.trim().toUpperCase()
  if (!code) return undefined

  return Array.from(state.rooms.values()).find((room) => room.code === code)
}

function findDiscoveredRoom(
  state: LanState,
  input: { roomId?: string; code?: string },
): DiscoveredRoom | undefined {
  pruneState(state)

  if (input.roomId) return state.discovered.get(input.roomId)

  const code = input.code?.trim().toUpperCase()
  if (!code) return undefined

  return Array.from(state.discovered.values()).find(
    (entry) => entry.room?.code === code,
  )
}

function findTargetRoom(
  state: LanState,
  input: { roomId?: string; code?: string },
): { local?: LanRoom; remote?: DiscoveredRoom } {
  const local = findLocalRoom(state, input)
  if (local) return { local }

  return { remote: findDiscoveredRoom(state, input) }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  let size = 0

  for await (const chunk of request) {
    const part = typeof chunk === 'string' ? chunk : chunk.toString()
    size += Buffer.byteLength(part)
    if (size > 256 * 1024) throw new Error('Corpo da requisição muito grande.')
    text += part
  }

  if (!text) return {}

  const parsed = JSON.parse(text)
  return parsed && typeof parsed === 'object'
    ? parsed as Record<string, unknown>
    : {}
}

async function forward(
  target: DiscoveredRoom,
  action: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5_000)

  try {
    const response = await fetch(
      'http://' + target.address + ':' + target.port + '/api/lan/rooms',
      {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      },
    )

    const body = await response.text()
    let parsed: unknown

    try {
      parsed = body ? JSON.parse(body) : null
    } catch {
      throw new Error('A máquina que hospeda a sala retornou uma resposta inválida.')
    }

    if (!response.ok) {
      const error =
        parsed &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof parsed.error === 'string'
          ? parsed.error
          : 'Não foi possível comunicar com a sala LAN.'

      throw new Error(error)
    }

    return parsed
  } finally {
    clearTimeout(timeout)
  }
}

function discoveryList(state: LanState) {
  pruneState(state)

  const local = Array.from(state.rooms.values())
    .filter((room) => room.status === 'waiting')
    .map((room) => ({
      ...publicRoom(room),
      passwordRequired: room.private,
    }))

  const remote = Array.from(state.discovered.values())
    .filter((entry) => entry.room?.status === 'waiting')
    .map((entry) => ({
      id: entry.room!.id,
      name: entry.room!.name,
      code: entry.room!.code,
      hostId: entry.room!.hostId,
      maxPlayers: entry.room!.maxPlayers,
      private: entry.room!.private,
      status: entry.room!.status,
      players: Array.from({ length: entry.room!.playerCount }, (_, index) => ({
        id: 'lan-player-' + index,
        name: index === 0 ? 'Host' : 'Jogador',
        host: index === 0,
        ready: false,
        teamSize: 0,
        lastSeen: Date.now(),
      })),
      createdAt: entry.room!.createdAt,
      passwordRequired: entry.room!.private,
      source: 'lan' as const,
    }))

  const unique = new Map<string, typeof local[number]>()
  for (const room of [...local, ...remote]) unique.set(room.id, room)

  return Array.from(unique.values()).sort((a, b) => b.createdAt - a.createdAt)
}

async function handleLanRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: LanState,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://bymon.lan')
  const path = url.pathname

  if (request.method === 'GET' && path === '/status') {
    json(response, { available: true, mode: 'lan' })
    return
  }

  if (request.method === 'POST' && path === '/discover') {
    sendPacket(state, {
      magic: DISCOVERY_MAGIC,
      kind: 'probe',
      port: state.serverPort,
    })

    json(response, { ok: true })
    return
  }

  if (request.method === 'GET' && path === '/discovery') {
    json(response, { rooms: discoveryList(state) })
    return
  }

  if (request.method === 'GET' && path === '/resolve') {
    const code = url.searchParams.get('code')?.trim().toUpperCase()
    if (!code) {
      json(response, { error: 'Código da sala não informado.' }, 400)
      return
    }

    const target = findTargetRoom(state, { code })

    if (target.local) {
      json(response, {
        room: {
          ...publicRoom(target.local),
          passwordRequired: target.local.private,
        },
      })
      return
    }

    if (target.remote?.room) {
      json(response, {
        room: {
          id: target.remote.room.id,
          name: target.remote.room.name,
          code: target.remote.room.code,
          hostId: target.remote.room.hostId,
          maxPlayers: target.remote.room.maxPlayers,
          private: target.remote.room.private,
          status: target.remote.room.status,
          players: Array.from({ length: target.remote.room.playerCount }, (_, index) => ({
            id: 'lan-player-' + index,
            name: index === 0 ? 'Host' : 'Jogador',
            host: index === 0,
            ready: false,
            teamSize: 0,
            lastSeen: Date.now(),
          })),
          createdAt: target.remote.room.createdAt,
          passwordRequired: target.remote.room.private,
          source: 'lan' as const,
        },
      })
      return
    }

    json(response, { error: 'Sala LAN não encontrada.' }, 404)
    return
  }

  if (request.method !== 'POST') {
    json(response, { error: 'Método não suportado.' }, 405)
    return
  }

  const body = await readBody(request)
  const action = body.action

  if (path === '/rooms' && action === 'create') {
    const privateRoom = Boolean(body.private)
    const password = typeof body.password === 'string' ? body.password.trim() : ''

    if (privateRoom && !password) {
      json(response, { error: 'Salas privadas precisam de uma senha.' }, 400)
      return
    }

    const playerId = randomUUID()
    const now = Date.now()

    const room: LanRoom = {
      id: randomUUID(),
      name: cleanName(body.name, 'Sala sem nome', 40),
      code: makeCode(state.rooms.values()),
      hostId: playerId,
      maxPlayers: normalizeLimit(body.maxPlayers),
      private: privateRoom,
      ...(privateRoom ? { password } : {}),
      status: 'waiting',
      players: [{
        id: playerId,
        name: cleanName(body.playerName, 'Jogador', 20),
        host: true,
        ready: false,
        teamSize: 0,
        teamPokemonIds: [],
        lastSeen: now,
      }],
      createdAt: now,
    }

    state.rooms.set(room.id, room)
    announceRoom(state, room)

    json(response, { room: publicRoom(room), playerId }, 201)
    return
  }

  const input = {
    roomId: typeof body.roomId === 'string' ? body.roomId : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
  }

  if (path === '/rooms' && action === 'join') {
    const target = findTargetRoom(state, input)

    if (target.remote) {
      json(response, await forward(target.remote, body), 200)
      return
    }

    const room = target.local
    if (!room) {
      json(response, { error: 'Sala LAN não encontrada.' }, 404)
      return
    }

    pruneState(state)

    if (room.status !== 'waiting') {
      json(response, { error: 'A batalha desta sala já começou.' }, 409)
      return
    }

    const suppliedPassword = typeof body.password === 'string' ? body.password.trim() : ''
    if (room.private && suppliedPassword !== room.password) {
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

    announceRoom(state, room)
    json(response, { room: publicRoom(room), playerId })
    return
  }

  const target = findTargetRoom(state, input)

  if (target.remote) {
    json(response, await forward(target.remote, body), 200)
    return
  }

  const room = target.local
  if (!room) {
    json(response, { error: 'Sala LAN não encontrada.' }, 404)
    return
  }

  if (action !== 'heartbeat' && action !== 'team' && action !== 'ready' && action !== 'leave') {
    json(response, { error: 'Ação inválida.' }, 400)
    return
  }

  const playerId = typeof body.playerId === 'string' ? body.playerId : ''
  const player = room.players.find((entry) => entry.id === playerId)

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
    room.players = room.players.filter((entry) => entry.id !== playerId)

    if (room.players.length === 0) {
      state.rooms.delete(room.id)
      sendPacket(state, {
        magic: DISCOVERY_MAGIC,
        kind: 'goodbye',
        room: discoveryRoom(room),
        port: state.serverPort,
      })
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

  announceRoom(state, room)
  json(response, { room: publicRoom(room) })
}

function createState(serverPort: number): LanState {
  const state: LanState = {
    rooms: new Map(),
    discovered: new Map(),
    socket: dgram.createSocket({ type: 'udp4', reuseAddr: true }),
    announceTimer: null,
    serverPort,
  }

  createSocket(state)
  state.announceTimer = setInterval(() => announceAll(state), ANNOUNCE_INTERVAL_MS)
  return state
}

export function bymonLanDiscoveryPlugin(): Plugin {
  return {
    name: 'bymon-lan-discovery',
    configureServer(server) {
      const address = server.httpServer?.address()
      const initialPort =
        typeof address === 'object' && address
          ? (address as AddressInfo).port
          : Number(server.config.server.port) || 5173

      const state = createState(initialPort)

      server.httpServer?.once('listening', () => {
        const listeningAddress = server.httpServer?.address()

        if (typeof listeningAddress === 'object' && listeningAddress) {
          state.serverPort = (listeningAddress as AddressInfo).port
          announceAll(state)
        }
      })

      server.middlewares.use('/api/lan', async (request, response) => {
        try {
          await handleLanRequest(request, response, state)
        } catch (error) {
          console.error('[ByMon LAN]', error)
          json(
            response,
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Servidor LAN indisponível.',
            },
            500,
          )
        }
      })

      server.httpServer?.once('close', () => {
        if (state.announceTimer) clearInterval(state.announceTimer)

        for (const room of state.rooms.values()) {
          try {
            sendPacket(state, {
              magic: DISCOVERY_MAGIC,
              kind: 'goodbye',
              room: discoveryRoom(room),
              port: state.serverPort,
            })
          } catch {
            // Ignore shutdown races.
          }
        }

        state.socket.close()
      })
    },
  }
}
