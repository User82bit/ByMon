import {
  pullOnlineSignals,
  sendOnlineSignal,
  type OnlineSignal,
} from './onlineRooms'
import type {
  OnlineRoom,
  RoomSession,
  P2PPlayerState,
  P2PSnapshot,
} from '../types/online'

const SIGNAL_POLL_MS = 700
export const ONLINE_TEAM_COLORS = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA',
  '#EC407A', '#00ACC1', '#FDD835', '#6D4C41', '#546E7A',
] as const
const ICE_SERVERS = getIceServers()

export function getOnlineTeamColor(index: number): string {
  return ONLINE_TEAM_COLORS[Math.abs(index) % ONLINE_TEAM_COLORS.length]
}

function normalizeTeamColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toUpperCase()
    : fallback
}

function errorFrom(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

type P2PMessage =
  | {
      type: 'snapshot'
      snapshot: P2PSnapshot
    }
  | {
      type: 'team_update'
      teamPokemonIds: number[]
      teamColor?: string
    }
  | {
      type: 'ready_update'
      ready: boolean
    }
  | {
      type: 'battle_start'
      snapshot: P2PSnapshot
    }

interface Callbacks {
  onSnapshot: (snapshot: P2PSnapshot) => void
  onConnectionChange: (connected: boolean) => void
  onError: (error: Error) => void
  onBattleStart?: (snapshot: P2PSnapshot) => void
}

interface PeerConnectionState {
  connection: RTCPeerConnection
  channel: RTCDataChannel
  pendingCandidates: RTCIceCandidateInit[]
}

function getIceServers(): RTCIceServer[] {
  const configured = import.meta.env.VITE_WEBRTC_ICE_SERVERS?.trim()

  if (configured) {
    try {
      const parsed = JSON.parse(configured) as RTCIceServer[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      const urls = configured
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean)

      if (urls.length > 0) {
        return urls.map((url: string) => ({ urls: url }))
      }
    }
  }

  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

function normalizeTeam(ids: number[]): number[] {
  return Array.from(
    new Set(
      ids
        .filter((id) => Number.isInteger(id) && id > 0)
        .slice(0, 6),
    ),
  )
}

function makePlayerStates(room: OnlineRoom): Map<string, P2PPlayerState> {
  return new Map(
    room.players.map((player, index) => [
      player.id,
      {
        id: player.id,
        name: player.name,
        host: player.host,
        ready: false,
        teamPokemonIds: [],
        teamColor: getOnlineTeamColor(index),
      },
    ]),
  )
}

function asDescription(data: unknown): RTCSessionDescriptionInit | null {
  if (!data || typeof data !== 'object') return null

  const candidate = data as { type?: unknown; sdp?: unknown }
  if (
    (candidate.type !== 'offer' && candidate.type !== 'answer') ||
    typeof candidate.sdp !== 'string'
  ) {
    return null
  }

  return {
    type: candidate.type,
    sdp: candidate.sdp,
  }
}

function asCandidate(data: unknown): RTCIceCandidateInit | null {
  if (!data || typeof data !== 'object') return null
  return data as RTCIceCandidateInit
}

function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: ICE_SERVERS,
  })
}

export class OnlineP2PHost {
  private readonly session: RoomSession
  private readonly callbacks: Callbacks
  private readonly players = new Map<string, P2PPlayerState>()
  private readonly peers = new Map<string, PeerConnectionState>()
  private pollTimer: number | null = null
  private polling = false
  private closed = false
  private status: P2PSnapshot['status']

  constructor(session: RoomSession, callbacks: Callbacks) {
    this.session = session
    this.callbacks = callbacks
    this.players = makePlayerStates(session.room)
    this.status = session.room.status
  }

  start(): void {
    this.startPolling()
    this.emitSnapshot()
  }

  syncRoom(room: OnlineRoom): void {
    if (this.closed) return

    if (this.status !== 'battle' || room.status === 'battle') {
      this.status = room.status
    }

    const activeIds = new Set(room.players.map((player) => player.id))

    for (const player of room.players) {
      const current = this.players.get(player.id)

      if (current) {
        current.name = player.name
        current.host = player.host
      } else {
        this.players.set(player.id, {
          id: player.id,
          name: player.name,
          host: player.host,
          ready: false,
          teamPokemonIds: [],
          teamColor: getOnlineTeamColor(room.players.findIndex((entry) => entry.id === player.id)),
        })
      }
    }

    for (const playerId of Array.from(this.players.keys())) {
      if (!activeIds.has(playerId)) {
        this.players.delete(playerId)
        this.closePeer(playerId)
      }
    }

    for (const player of room.players) {
      if (player.id === this.session.playerId) continue
      if (!this.peers.has(player.id)) {
        void this.connectPlayer(player.id)
      }
    }

    this.emitSnapshot()
  }

  updateLocalTeam(teamPokemonIds: number[], teamColor?: string): void {
    const player = this.players.get(this.session.playerId)
    if (!player) return

    player.teamPokemonIds = normalizeTeam(teamPokemonIds)
    player.teamColor = normalizeTeamColor(teamColor, player.teamColor)
    player.ready = false
    this.emitSnapshot()
    this.broadcastSnapshot()
  }

  updateLocalReady(ready: boolean): boolean {
    const player = this.players.get(this.session.playerId)
    if (!player) return false

    if (ready && player.teamPokemonIds.length === 0) {
      this.callbacks.onError(new Error('Monte seu time antes de ficar pronto.'))
      return false
    }

    player.ready = ready
    this.emitSnapshot()

    if (this.shouldStartBattle()) {
      this.status = 'battle'
      const snapshot = this.getSnapshot()
      this.emitSnapshot()
      this.broadcast({
        type: 'battle_start',
        snapshot,
      })
      this.callbacks.onBattleStart?.(snapshot)
      return true
    }

    this.broadcastSnapshot()
    return true
  }

  getSnapshot(): P2PSnapshot {
    return {
      status: this.status,
      players: Array.from(this.players.values()).map((player) => ({
        ...player,
        teamPokemonIds: [...player.teamPokemonIds],
      })),
    }
  }

  close(): void {
    this.closed = true

    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    for (const playerId of Array.from(this.peers.keys())) {
      this.closePeer(playerId)
    }
  }

  private shouldStartBattle(): boolean {
    const players = Array.from(this.players.values())
    return (
      players.length >= 2 &&
      players.every(
        (player) => player.ready && player.teamPokemonIds.length > 0,
      )
    )
  }

  private async connectPlayer(playerId: string): Promise<void> {
    if (
      this.closed ||
      this.peers.has(playerId) ||
      playerId === this.session.playerId
    ) {
      return
    }

    const connection = createPeerConnection()
    const channel = connection.createDataChannel('bymon', {
      ordered: true,
    })

    const peer: PeerConnectionState = {
      connection,
      channel,
      pendingCandidates: [],
    }

    this.peers.set(playerId, peer)

    connection.onicecandidate = (event) => {
      if (!event.candidate) return

      void this.sendSignal(
        playerId,
        'ice-candidate',
        event.candidate.toJSON(),
      ).catch((error: unknown) => {
        this.callbacks.onError(errorFrom(error, 'Não foi possível enviar um candidato ICE.'))
      })
    }

    connection.onconnectionstatechange = () => {
      if (
        connection.connectionState === 'failed' ||
        connection.connectionState === 'closed'
      ) {
        this.closePeer(playerId)
        return
      }

      this.callbacks.onConnectionChange(this.hasOpenConnection())
    }

    channel.onopen = () => {
      this.callbacks.onConnectionChange(this.hasOpenConnection())
      this.sendSnapshotTo(playerId)
    }

    channel.onclose = () => {
      this.callbacks.onConnectionChange(this.hasOpenConnection())
    }

    channel.onerror = () => {
      this.callbacks.onError(new Error('A conexão P2P com um jogador falhou.'))
    }

    channel.onmessage = (event) => {
      this.handleClientMessage(playerId, event.data)
    }

    try {
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)

      const description = connection.localDescription
      if (!description) throw new Error('Não foi possível criar a oferta WebRTC.')

      await this.sendSignal(playerId, 'offer', {
        type: description.type,
        sdp: description.sdp,
      })
    } catch (error) {
      this.closePeer(playerId)
      this.callbacks.onError(
        error instanceof Error
          ? error
          : new Error('Não foi possível iniciar a conexão P2P.'),
      )
    }
  }

  private handleClientMessage(playerId: string, raw: unknown): void {
    if (typeof raw !== 'string') return

    let message: P2PMessage

    try {
      message = JSON.parse(raw) as P2PMessage
    } catch {
      return
    }

    if (message.type === 'team_update') {
      const player = this.players.get(playerId)
      if (!player) return

      player.teamPokemonIds = normalizeTeam(message.teamPokemonIds)
      player.teamColor = normalizeTeamColor(message.teamColor, player.teamColor)
      player.ready = false
      this.emitSnapshot()
      this.broadcastSnapshot()
      return
    }

    if (message.type === 'ready_update') {
      const player = this.players.get(playerId)
      if (!player) return

      if (
        message.ready &&
        player.teamPokemonIds.length === 0
      ) {
        this.sendTo(playerId, {
          type: 'snapshot',
          snapshot: this.getSnapshot(),
        })
        return
      }

      player.ready = Boolean(message.ready)

      if (this.shouldStartBattle()) {
        this.status = 'battle'
        const snapshot = this.getSnapshot()
        this.emitSnapshot()
        this.broadcast({
          type: 'battle_start',
          snapshot,
        })
        this.callbacks.onBattleStart?.(snapshot)
      } else {
        this.emitSnapshot()
        this.broadcastSnapshot()
      }
    }
  }

  private async pullSignals(): Promise<void> {
    if (this.closed || this.polling) return
    this.polling = true

    try {
      const signals = await pullOnlineSignals({
        roomId: this.session.room.id,
        playerId: this.session.playerId,
        sessionToken: this.session.sessionToken,
      })

      for (const signal of signals) {
        await this.handleSignal(signal)
      }
    } catch (error) {
      if (!this.closed) {
        this.callbacks.onError(
          error instanceof Error
            ? error
            : new Error('Não foi possível receber a sinalização P2P.'),
        )
      }
    } finally {
      this.polling = false

      if (!this.closed) {
        this.pollTimer = window.setTimeout(
          () => void this.pullSignals(),
          SIGNAL_POLL_MS,
        )
      }
    }
  }

  private async handleSignal(signal: OnlineSignal): Promise<void> {
    const peer = this.peers.get(signal.fromPlayerId)
    if (!peer) return

    if (signal.signalType === 'answer') {
      const answer = asDescription(signal.data)
      if (!answer) return

      await peer.connection.setRemoteDescription(answer)

      for (const candidate of peer.pendingCandidates.splice(0)) {
        await peer.connection.addIceCandidate(candidate)
      }

      return
    }

    if (signal.signalType === 'ice-candidate') {
      const candidate = asCandidate(signal.data)
      if (!candidate) return

      if (peer.connection.remoteDescription) {
        await peer.connection.addIceCandidate(candidate)
      } else {
        peer.pendingCandidates.push(candidate)
      }
    }
  }

  private startPolling(): void {
    if (this.closed || this.pollTimer !== null) return
    this.pollTimer = window.setTimeout(
      () => void this.pullSignals(),
      SIGNAL_POLL_MS,
    )
  }

  private async sendSignal(
    targetPlayerId: string,
    signalType: OnlineSignal['signalType'],
    data: unknown,
  ): Promise<void> {
    await sendOnlineSignal({
      roomId: this.session.room.id,
      playerId: this.session.playerId,
      sessionToken: this.session.sessionToken,
      targetPlayerId,
      signalType,
      data,
    })
  }

  private sendTo(playerId: string, message: P2PMessage): void {
    const peer = this.peers.get(playerId)
    if (!peer || peer.channel.readyState !== 'open') return
    peer.channel.send(JSON.stringify(message))
  }

  private broadcast(message: P2PMessage): void {
    for (const playerId of this.peers.keys()) {
      this.sendTo(playerId, message)
    }
  }

  private broadcastSnapshot(): void {
    this.broadcast({
      type: 'snapshot',
      snapshot: this.getSnapshot(),
    })
  }

  private sendSnapshotTo(playerId: string): void {
    this.sendTo(playerId, {
      type: 'snapshot',
      snapshot: this.getSnapshot(),
    })
  }

  private emitSnapshot(): void {
    this.callbacks.onSnapshot(this.getSnapshot())
  }

  private hasOpenConnection(): boolean {
    return Array.from(this.peers.values()).some(
      (peer) => peer.channel.readyState === 'open',
    )
  }

  private closePeer(playerId: string): void {
    const peer = this.peers.get(playerId)
    if (!peer) return

    this.peers.delete(playerId)
    peer.channel.close()
    peer.connection.close()
    this.callbacks.onConnectionChange(this.hasOpenConnection())
  }
}

export class OnlineP2PPeer {
  private readonly session: RoomSession
  private readonly callbacks: Callbacks
  private connection: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private pendingCandidates: RTCIceCandidateInit[] = []
  private pollTimer: number | null = null
  private polling = false
  private closed = false

  constructor(session: RoomSession, callbacks: Callbacks) {
    this.session = session
    this.callbacks = callbacks
  }

  start(): void {
    this.startPolling()
  }

  sendTeam(teamPokemonIds: number[], teamColor?: string): void {
    this.send({
      type: 'team_update',
      teamPokemonIds: normalizeTeam(teamPokemonIds),
      ...(teamColor ? { teamColor: normalizeTeamColor(teamColor, '#1E88E5') } : {}),
    })
  }

  sendReady(ready: boolean): void {
    this.send({
      type: 'ready_update',
      ready,
    })
  }

  close(): void {
    this.closed = true

    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer)
      this.pollTimer = null
    }

    this.channel?.close()
    this.connection?.close()
    this.channel = null
    this.connection = null
  }

  isConnected(): boolean {
    return this.channel?.readyState === 'open'
  }

  private createConnection(): RTCPeerConnection {
    if (this.connection) return this.connection

    const connection = createPeerConnection()
    this.connection = connection

    connection.onicecandidate = (event) => {
      if (!event.candidate) return

      void this.sendSignal(
        'ice-candidate',
        event.candidate.toJSON(),
      ).catch((error: unknown) => {
        this.callbacks.onError(errorFrom(error, 'Não foi possível enviar um candidato ICE.'))
      })
    }

    connection.onconnectionstatechange = () => {
      if (
        !this.closed &&
        this.connection === connection &&
        (connection.connectionState === 'failed' ||
          connection.connectionState === 'closed')
      ) {
        this.connection = null
        this.channel = null
        this.pendingCandidates = []
        this.callbacks.onConnectionChange(false)
      }
    }

    connection.ondatachannel = (event) => {
      const channel = event.channel
      this.channel = channel
      channel.onopen = () => {
        if (!this.closed && this.channel === channel) {
          this.callbacks.onConnectionChange(true)
        }
      }
      channel.onclose = () => {
        if (this.channel === channel) {
          this.callbacks.onConnectionChange(false)
        }
      }
      channel.onerror = () => {
        this.callbacks.onError(new Error('A conexão com o host falhou.'))
      }
      channel.onmessage = (messageEvent) => {
        this.handleMessage(messageEvent.data)
      }
    }

    return connection
  }

  private async pullSignals(): Promise<void> {
    if (this.closed || this.polling) return
    this.polling = true

    try {
      const signals = await pullOnlineSignals({
        roomId: this.session.room.id,
        playerId: this.session.playerId,
        sessionToken: this.session.sessionToken,
      })

      for (const signal of signals) {
        await this.handleSignal(signal)
      }
    } catch (error) {
      if (!this.closed) {
        this.callbacks.onError(
          error instanceof Error
            ? error
            : new Error('Não foi possível receber a sinalização P2P.'),
        )
      }
    } finally {
      this.polling = false

      if (!this.closed) {
        this.pollTimer = window.setTimeout(
          () => void this.pullSignals(),
          SIGNAL_POLL_MS,
        )
      }
    }
  }

  private async handleSignal(signal: OnlineSignal): Promise<void> {
    const connection = this.createConnection()

    if (signal.signalType === 'ice-candidate') {
      const candidate = asCandidate(signal.data)
      if (!candidate) return

      if (connection.remoteDescription) {
        await connection.addIceCandidate(candidate)
      } else {
        this.pendingCandidates.push(candidate)
      }

      return
    }

    if (signal.signalType !== 'offer') {
      return
    }

    const offer = asDescription(signal.data)
    if (!offer) return

    await connection.setRemoteDescription(offer)

    for (const candidate of this.pendingCandidates.splice(0)) {
      await connection.addIceCandidate(candidate)
    }

    const answer = await connection.createAnswer()
    await connection.setLocalDescription(answer)

    const description = connection.localDescription
    if (!description) {
      throw new Error('Não foi possível responder à oferta WebRTC.')
    }

    await this.sendSignal('answer', {
      type: description.type,
      sdp: description.sdp,
    })
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return

    try {
      const message = JSON.parse(raw) as P2PMessage

      if (message.type === 'snapshot') {
        this.callbacks.onSnapshot(message.snapshot)
      }

      if (message.type === 'battle_start') {
        this.callbacks.onSnapshot(message.snapshot)
        this.callbacks.onBattleStart?.(message.snapshot)
      }
    } catch {
      // Ignore malformed messages from a remote browser.
    }
  }

  private startPolling(): void {
    if (this.closed || this.pollTimer !== null) return

    this.pollTimer = window.setTimeout(
      () => void this.pullSignals(),
      SIGNAL_POLL_MS,
    )
  }

  private send(message: P2PMessage): void {
    if (!this.channel || this.channel.readyState !== 'open') {
      this.callbacks.onError(new Error('A conexão P2P com o host ainda não está pronta.'))
      return
    }

    this.channel.send(JSON.stringify(message))
  }

  private async sendSignal(
    signalType: OnlineSignal['signalType'],
    data: unknown,
  ): Promise<void> {
    await sendOnlineSignal({
      roomId: this.session.room.id,
      playerId: this.session.playerId,
      sessionToken: this.session.sessionToken,
      targetPlayerId: this.session.room.hostId,
      signalType,
      data,
    })
  }
}
