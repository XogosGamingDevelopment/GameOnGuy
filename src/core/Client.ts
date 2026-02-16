/**
 * Game On Dude! - Client
 * www.gameonguy.com
 *
 * Represents a connected client with WebSocket management.
 */

import { WebSocket, RawData } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ClientInfo, Message, MessageType } from './types';
import { TypedEventEmitter } from './EventEmitter';
import logger from './Logger';
import * as msgpack from 'msgpack-lite';

interface ClientEvents {
  [key: string]: (...args: any[]) => void;
  message: (message: Message) => void;
  close: (code: number, reason: string) => void;
  error: (error: Error) => void;
  authenticated: () => void;
}

export class Client extends TypedEventEmitter<ClientEvents> implements ClientInfo {
  public readonly id: string;
  public readonly sessionId: string;
  public userId?: string;
  public username?: string;
  public readonly socket: WebSocket;
  public isAuthenticated: boolean = false;
  public readonly connectedAt: number;
  public lastHeartbeat: number;
  public currentRoomId?: string;
  public metadata: Record<string, unknown> = {};

  private messageSequence: number = 0;
  private useBinary: boolean = false;
  private readonly log;

  constructor(socket: WebSocket, options?: { useBinary?: boolean }) {
    super();
    this.id = uuidv4();
    this.sessionId = uuidv4();
    this.socket = socket;
    this.connectedAt = Date.now();
    this.lastHeartbeat = Date.now();
    this.useBinary = options?.useBinary ?? false;

    this.log = logger.child({ clientId: this.id });

    this.setupSocketHandlers();
  }

  private setupSocketHandlers(): void {
    this.socket.on('message', (data: RawData) => {
      try {
        const message = this.parseMessage(data);
        if (message) {
          this.handleMessage(message);
        }
      } catch (error) {
        this.log.error({ error }, 'Failed to parse message');
        this.sendError('Invalid message format');
      }
    });

    this.socket.on('close', (code: number, reason: Buffer) => {
      this.log.info({ code, reason: reason.toString() }, 'Client disconnected');
      this.emit('close', code, reason.toString());
    });

    this.socket.on('error', (error: Error) => {
      this.log.error({ error }, 'WebSocket error');
      this.emit('error', error);
    });

    this.socket.on('pong', () => {
      this.lastHeartbeat = Date.now();
    });
  }

  private parseMessage(data: RawData): Message | null {
    if (this.useBinary && data instanceof Buffer) {
      return msgpack.decode(data) as Message;
    }
    return JSON.parse(data.toString()) as Message;
  }

  private handleMessage(message: Message): void {
    // Handle ping/pong internally
    if (message.type === MessageType.PING) {
      this.send({ type: MessageType.PONG, timestamp: Date.now() });
      this.lastHeartbeat = Date.now();
      return;
    }

    this.emit('message', message);
  }

  public send<T>(message: Message<T>): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.log.warn('Attempted to send message to closed socket');
      return;
    }

    const fullMessage: Message<T> = {
      ...message,
      timestamp: message.timestamp ?? Date.now(),
      sequence: this.messageSequence++,
    };

    try {
      if (this.useBinary) {
        this.socket.send(msgpack.encode(fullMessage));
      } else {
        this.socket.send(JSON.stringify(fullMessage));
      }
    } catch (error) {
      this.log.error({ error }, 'Failed to send message');
    }
  }

  public sendError(message: string, code?: string): void {
    this.send({
      type: MessageType.ERROR,
      payload: { message, code },
    });
  }

  public authenticate(userId: string, username: string): void {
    this.userId = userId;
    this.username = username;
    this.isAuthenticated = true;
    this.emit('authenticated');
    this.log.info({ userId, username }, 'Client authenticated');
  }

  public setRoom(roomId: string | undefined): void {
    this.currentRoomId = roomId;
  }

  public ping(): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.ping();
    }
  }

  public isAlive(timeout: number): boolean {
    return Date.now() - this.lastHeartbeat < timeout;
  }

  public close(code: number = 1000, reason: string = 'Connection closed'): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(code, reason);
    }
  }

  public getInfo(): Omit<ClientInfo, 'socket'> {
    return {
      id: this.id,
      sessionId: this.sessionId,
      userId: this.userId,
      username: this.username,
      isAuthenticated: this.isAuthenticated,
      connectedAt: this.connectedAt,
      lastHeartbeat: this.lastHeartbeat,
      currentRoomId: this.currentRoomId,
      metadata: this.metadata,
    };
  }
}
