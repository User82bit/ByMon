export type OnlineRoomStatus = 'waiting' | 'battle'

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
}

export interface RoomSession {
  room: OnlineRoom
  playerId: string
  sessionToken: string
}

export interface P2PPlayerState {
  id: string
  name: string
  host: boolean
  ready: boolean
  teamPokemonIds: number[]
  teamColor: string
}

export interface P2PSnapshot {
  status: OnlineRoomStatus
  players: P2PPlayerState[]
}
