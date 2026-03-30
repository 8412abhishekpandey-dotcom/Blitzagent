/**
 * Logger Utility
 * 
 * Structured logging with Winston. Outputs to console + log files.
 * Each task gets its own log context.
 */
// importing dotenv

import winston from 'winston';
import { mkdirSync, existsSync } from 'fs';

// Ensure log directories exist
for (const dir of ['logs', 'screenshots']) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.printf(({ timestamp, level, message, module }) => {
    return `${timestamp} [${level.toUpperCase().padEnd(5)}] [${module}] ${message}`;
  })
);

const mainLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat,
      ),
    }),
    new winston.transports.File({
      filename: 'logs/agent.log',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: 'logs/errors.log',
      level: 'error',
    }),
  ],
});

/**
 * Create a child logger with module context.
 * @param {string} moduleName
 * @returns {winston.Logger}
 */
export function createLogger(moduleName) {
  return mainLogger.child({ module: moduleName });
}

export default mainLogger;
