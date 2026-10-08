import type { OnlineRoom, RoomListItem, RoomSession } from '../types/online'

const API_URL = '/api/rooms'

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
  return request<RoomSession>({
    method: 'POST',
    body: JSON.stringify({ action: 'join', ...input }),
  })
}

export async function getOnlineRoom(
  roomId: string,
  playerId: string,
  sessionToken: string,
): Promise<OnlineRoom> {
  const data = await request<{ room: OnlineRoom }>(
    undefined,
    '?roomId=' +
      encodeURIComponent(roomId) +
      '&playerId=' +
      encodeURIComponent(playerId) +
      '&sessionToken=' +
      encodeURIComponent(sessionToken),
  )

  return data.room
}

export async function heartbeatOnlinePlayer(
  roomId: string,
  playerId: string,
  sessionToken: string,
): Promise<OnlineRoom> {
  const data = await request<{ room: OnlineRoom }>({
    method: 'POST',
    body: JSON.stringify({
      action: 'heartbeat',
      roomId,
      playerId,
      sessionToken,
    }),
  })

  return data.room
}

export async function setOnlineRoomStatus(
  roomId: string,
  playerId: string,
  sessionToken: string,
  status: 'waiting' | 'battle',
): Promise<OnlineRoom> {
  const data = await request<{ room: OnlineRoom }>({
    method: 'POST',
    body: JSON.stringify({
      action: 'status',
      roomId,
      playerId,
      sessionToken,
      status,
    }),
  })

  return data.room
}

export async function leaveOnlineRoom(
  roomId: string,
  playerId: string,
  sessionToken: string,
): Promise<void> {
  await request({
    method: 'POST',
    body: JSON.stringify({
      action: 'leave',
      roomId,
      playerId,
      sessionToken,
    }),
  })
}

export interface OnlineSignal {
  fromPlayerId: string
  signalType: 'offer' | 'answer' | 'ice-candidate'
  data: unknown
  createdAt: number
}

export async function sendOnlineSignal(input: {
  roomId: string
  playerId: string
  sessionToken: string
  targetPlayerId: string
  signalType: OnlineSignal['signalType']
  data: unknown
}): Promise<void> {
  await request({
    method: 'POST',
    body: JSON.stringify({
      action: 'signal-send',
      ...input,
    }),
  })
}

export async function pullOnlineSignals(input: {
  roomId: string
  playerId: string
  sessionToken: string
}): Promise<OnlineSignal[]> {
  const data = await request<{ signals: OnlineSignal[] }>({
    method: 'POST',
    body: JSON.stringify({
      action: 'signal-pull',
      ...input,
    }),
  })

  return data.signals
}
