/**
 * Game On Dude! - Logger
 *
 * Centralized logging with pino for high-performance structured logging.
 *
 * www.gameonguy.com
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'gameondude',
  },
});

export const createChildLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
};

export default logger;
