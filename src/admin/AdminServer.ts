/**
 * Game On Dude! - Admin Server
 * www.gameonguy.com
 *
 * HTTP API for server administration, monitoring, and management.
 */

import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { GameOnServer } from '../core/Server';
import { BotRegistry } from '../bots/BotRegistry';
import logger from '../core/Logger';

// Build timestamp for deployment verification
const BUILD_TIMESTAMP = new Date().toISOString();

const log = logger.child({ component: 'AdminServer' });

export function startAdminServer(server: GameOnServer, port: number) {
  const app = express();

  // Middleware
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Request logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    log.debug({ method: req.method, path: req.path }, 'Admin request');
    next();
  });

  // ============================================================================
  // Security: admin API access control
  //
  // - If ADMIN_API_KEY is set: every route except /health requires the
  //   `x-admin-key` header (timing-safe comparison).
  // - If it is NOT set and NODE_ENV=production: mutating routes (POST/DELETE)
  //   are disabled so an accidentally exposed admin port can't kill rooms or
  //   broadcast to players. Read-only monitoring endpoints stay available.
  // - In development with no key set: everything stays open (unchanged).
  // ============================================================================
  const adminApiKey = process.env.ADMIN_API_KEY;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!adminApiKey && isProduction) {
    log.warn(
      'ADMIN_API_KEY is not set — mutating admin endpoints (POST/DELETE) are disabled in production'
    );
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next();

    if (adminApiKey) {
      const provided = req.header('x-admin-key') || '';
      const a = Buffer.from(provided);
      const b = Buffer.from(adminApiKey);
      const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid or missing x-admin-key header' });
      }
      return next();
    }

    if (isProduction && req.method !== 'GET') {
      return res.status(403).json({
        error: 'Mutating admin endpoints are disabled: set ADMIN_API_KEY to enable them',
      });
    }

    next();
  });

  // ============================================================================
  // Health & Status Endpoints
  // ============================================================================

  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/stats', (req: Request, res: Response) => {
    res.json(server.getStats());
  });

  app.get('/info', (req: Request, res: Response) => {
    res.json({
      version: '1.0.1',
      buildTimestamp: BUILD_TIMESTAMP,
      name: 'Game On Dude!',
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      memory: process.memoryUsage(),
      registeredGames: server.roomManager.getRegisteredGameTypes(),
      registeredBots: BotRegistry.getAllBots().map(b => ({
        type: b.botType,
        games: b.supportedGames,
        name: b.metadata?.name,
      })),
      botSupportedGames: BotRegistry.getSupportedGameTypes(),
      matchmakingQueueSize: server.matchmaking.getQueueSize(),
    });
  });

  // ============================================================================
  // Room Management Endpoints
  // ============================================================================

  app.get('/rooms', (req: Request, res: Response) => {
    const { gameType, state, hasSpace } = req.query;

    const rooms = server.roomManager.listRooms({
      gameType: gameType as string,
      state: state as any,
      hasSpace: hasSpace === 'true',
    });

    res.json({
      count: rooms.length,
      rooms,
    });
  });

  app.get('/rooms/:roomId', (req: Request, res: Response) => {
    const room = server.roomManager.getRoom(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    res.json({
      info: room.getInfo(),
      players: room.getPlayers(),
      state: room.getState(),
    });
  });

  app.post('/rooms', (req: Request, res: Response) => {
    const { gameType, options } = req.body;

    if (!gameType) {
      return res.status(400).json({ error: 'gameType is required' });
    }

    server.roomManager
      .createRoom(gameType, options)
      .then((room) => {
        res.status(201).json(room.getInfo());
      })
      .catch((error) => {
        res.status(400).json({ error: error.message });
      });
  });

  app.delete('/rooms/:roomId', (req: Request, res: Response) => {
    const room = server.roomManager.getRoom(req.params.roomId);

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    room.dispose();
    res.json({ success: true });
  });

  // ============================================================================
  // Game Type Endpoints
  // ============================================================================

  app.get('/games', (req: Request, res: Response) => {
    const gameTypes = server.roomManager.getRegisteredGameTypes();
    const games = gameTypes.map((type) => ({
      type,
      config: server.roomManager.getGameConfig(type),
    }));

    res.json({ games });
  });

  app.get('/games/:gameType', (req: Request, res: Response) => {
    const config = server.roomManager.getGameConfig(req.params.gameType);

    if (!config) {
      return res.status(404).json({ error: 'Game type not found' });
    }

    const rooms = server.roomManager.getRoomsByGameType(req.params.gameType);

    res.json({
      config,
      activeRooms: rooms.length,
      rooms: rooms.map((r) => r.getInfo()),
    });
  });

  // ============================================================================
  // Matchmaking Endpoints
  // ============================================================================

  app.get('/matchmaking', (req: Request, res: Response) => {
    const { gameType, gameMode } = req.query;

    res.json({
      queueSize: server.matchmaking.getQueueSize(
        gameType as string,
        gameMode as string
      ),
    });
  });

  // ============================================================================
  // Broadcast Endpoint
  // ============================================================================

  app.post('/broadcast', (req: Request, res: Response) => {
    const { message, roomId } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    if (roomId) {
      const room = server.roomManager.getRoom(roomId);
      if (room) {
        room.broadcast({ type: 'admin_message', payload: message });
        res.json({ success: true, scope: 'room', roomId });
      } else {
        res.status(404).json({ error: 'Room not found' });
      }
    } else {
      server.broadcast({ type: 'admin_message', payload: message });
      res.json({ success: true, scope: 'global' });
    }
  });

  // ============================================================================
  // Error Handler
  // ============================================================================

  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    log.error({ error: err }, 'Admin server error');
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  app.listen(port, () => {
    log.info({ port }, 'Admin server started');
  });

  return app;
}
