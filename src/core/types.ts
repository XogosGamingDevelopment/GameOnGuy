/**
 * Game On Dude! - Core Types
 * www.gameonguy.com
 *
 * This file defines all the core types used throughout the multiplayer platform.
 */

import { WebSocket } from 'ws';

// ============================================================================
// Message Types
// ============================================================================

export enum MessageType {
  // Connection
  PING = 'ping',
  PONG = 'pong',
  AUTH = 'auth',
  AUTH_SUCCESS = 'auth_success',
  AUTH_FAILURE = 'auth_failure',
  DISCONNECT = 'disconnect',

  // Room Management
  ROOM_CREATE = 'room_create',
  ROOM_JOIN = 'room_join',
  ROOM_LEAVE = 'room_leave',
  ROOM_LIST = 'room_list',
  ROOM_INFO = 'room_info',
  ROOM_CREATED = 'room_created',
  ROOM_JOINED = 'room_joined',
  ROOM_LEFT = 'room_left',
  ROOM_ERROR = 'room_error',
  ROOM_STATE = 'room_state',
  ROOM_CLOSED = 'room_closed',

  // Player Events
  PLAYER_JOINED = 'player_joined',
  PLAYER_LEFT = 'player_left',
  PLAYER_READY = 'player_ready',
  PLAYER_UPDATE = 'player_update',

  // Game Events
  GAME_START = 'game_start',
  GAME_END = 'game_end',
  GAME_STATE = 'game_state',
  GAME_ACTION = 'game_action',
  GAME_EVENT = 'game_event',

  // State Sync
  STATE_FULL = 'state_full',
  STATE_PATCH = 'state_patch',

  // Matchmaking
  MATCHMAKE_REQUEST = 'matchmake_request',
  MATCHMAKE_FOUND = 'matchmake_found',
  MATCHMAKE_CANCEL = 'matchmake_cancel',
  MATCHMAKE_TIMEOUT = 'matchmake_timeout',

  // Error
  ERROR = 'error',
}

export interface Message<T = unknown> {
  type: MessageType | string;
  payload?: T;
  timestamp?: number;
  sequence?: number;
}

// ============================================================================
// Client Types
// ============================================================================

export interface ClientInfo {
  id: string;
  sessionId: string;
  userId?: string;
  username?: string;
  socket: WebSocket;
  isAuthenticated: boolean;
  connectedAt: number;
  lastHeartbeat: number;
  currentRoomId?: string;
  metadata: Record<string, unknown>;
}

export interface PlayerState {
  id: string;
  sessionId: string;
  userId?: string;
  username: string;
  isReady: boolean;
  isConnected: boolean;
  joinedAt: number;
  lastActivity: number;
  data: Record<string, unknown>;
}

// ============================================================================
// Room Types
// ============================================================================

export enum RoomState {
  WAITING = 'waiting',
  STARTING = 'starting',
  IN_PROGRESS = 'in_progress',
  PAUSED = 'paused',
  FINISHED = 'finished',
  CLOSED = 'closed',
}

export interface RoomOptions {
  maxPlayers: number;
  minPlayers: number;
  isPrivate: boolean;
  password?: string;
  gameType: string;
  gameMode?: string;
  tickRate: number;
  metadata?: Record<string, unknown>;
  autoStart?: boolean;
  autoDispose?: boolean;
  autoDisposeDelay?: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  gameType: string;
  gameMode?: string;
  state: RoomState;
  playerCount: number;
  maxPlayers: number;
  isPrivate: boolean;
  hasPassword: boolean;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface RoomListFilter {
  gameType?: string;
  gameMode?: string;
  state?: RoomState;
  isPrivate?: boolean;
  hasSpace?: boolean;
}

// ============================================================================
// Game Types
// ============================================================================

export enum GameCategory {
  TRIVIA = 'trivia',
  REAL_TIME = 'real_time',
  TURN_BASED = 'turn_based',
  HYBRID = 'hybrid',
}

export interface GameConfig {
  type: string;
  name: string;
  category: GameCategory;
  minPlayers: number;
  maxPlayers: number;
  defaultTickRate: number;
  supportedModes: string[];
  settings: Record<string, unknown>;
}

export interface GameAction {
  type: string;
  playerId: string;
  data: unknown;
  timestamp: number;
  sequence?: number;
}

// ============================================================================
// Matchmaking Types
// ============================================================================

export interface MatchmakingRequest {
  playerId: string;
  sessionId: string;
  gameType: string;
  gameMode?: string;
  skill?: number;
  preferences?: Record<string, unknown>;
  timestamp: number;
}

export interface MatchmakingTicket {
  id: string;
  request: MatchmakingRequest;
  status: 'pending' | 'matched' | 'cancelled' | 'timeout';
  roomId?: string;
  createdAt: number;
  expiresAt: number;
}

// ============================================================================
// Authentication Types
// ============================================================================

export interface AuthPayload {
  token?: string;
  userId?: string;
  username?: string;
  guestId?: string;
}

export interface UserSession {
  sessionId: string;
  userId?: string;
  username: string;
  isGuest: boolean;
  createdAt: number;
  expiresAt: number;
  metadata: Record<string, unknown>;
}

export interface JWTPayload {
  userId: string;
  username: string;
  email?: string;
  iat: number;
  exp: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

export interface ServerEvents {
  [key: string]: (...args: any[]) => void;
  clientConnected: (client: ClientInfo) => void;
  clientDisconnected: (client: ClientInfo, reason: string) => void;
  clientAuthenticated: (client: ClientInfo) => void;
  roomCreated: (room: RoomInfo) => void;
  roomClosed: (roomId: string) => void;
  playerJoinedRoom: (roomId: string, player: PlayerState) => void;
  playerLeftRoom: (roomId: string, playerId: string) => void;
  gameStarted: (roomId: string) => void;
  gameEnded: (roomId: string, results: unknown) => void;
  error: (error: Error, context?: unknown) => void;
}

// ============================================================================
// State Sync Types
// ============================================================================

export interface StatePatch {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

export interface StateSnapshot<T = unknown> {
  state: T;
  timestamp: number;
  sequence: number;
}

// ============================================================================
// Server Config
// ============================================================================

export interface ServerConfig {
  port: number;
  adminPort: number;
  host: string;
  wsPath: string;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  maxRoomsPerServer: number;
  maxPlayersPerRoom: number;
  tickRateDefault: number;
  tickRateFPS: number;
  tickRateTurnBased: number;
}
