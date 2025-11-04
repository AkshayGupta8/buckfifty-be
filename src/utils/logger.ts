import { createLogger, format, transports } from 'winston';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

const logDir = path.resolve(process.cwd(), 'logs');

const asyncLocalStorage = new AsyncLocalStorage<Map<string, any>>();

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => {
      const store = asyncLocalStorage.getStore();
      const requestId = store ? store.get('requestId') : undefined;
      const requestIdStr = requestId ? `[RequestId: ${requestId}] ` : '';
      return `${timestamp} [${level.toUpperCase()}]: ${requestIdStr}${message}`;
    })
  ),
  transports: [
    new transports.File({ filename: path.join(logDir, 'app.log'), level: 'info' }),
    new transports.Console({ level: 'debug' })
  ],
  exitOnError: false,
});

export { asyncLocalStorage };
export default logger;
