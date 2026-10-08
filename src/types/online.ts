export type OnlineRoomStatus = 'waiting' | 'battle'
export type OnlineRoomSource = 'local' | 'lan' | 'server'

export interface OnlinePlayer {
  id: string
  name: string
  host: boolean
  ready: boolean
  teamSize: number
  lastSeen: number
}

export interface OnlineRoom {
  id: string
  name: string
  code: string
  hostId: string
  maxPlayers: number
  private: boolean
  status: OnlineRoomStatus
  players: OnlinePlayer[]
  createdAt: number
}

export interface RoomListItem extends OnlineRoom {
  passwordRequired: boolean
  source?: OnlineRoomSource
}

export interface RoomSession {
  room: OnlineRoom
  playerId: string
  source?: OnlineRoomSource
}
