import type { OnlineRoom, RoomListItem, RoomSession } from '../types/online'

const API_URL = '/api/rooms'

async function request<T>(input: RequestInit = {}, query = ''): Promise<T> {
  const response = await fetch(API_URL + query, {
    ...input,
    headers: {
      'Content-Type': 'application/json',
      ...(input.headers ?? {}),
    },
  })

  const data = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    throw new Error(data.error ?? 'Falha na comunicação com o servidor.')
  }

  return data
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
): Promise<OnlineRoom> {
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
  await request({
    method: 'POST',
    body: JSON.stringify({
      action: 'leave',
      roomId,
      playerId,
    }),
  })
}
