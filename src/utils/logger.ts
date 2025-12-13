import pino from 'pino';
import { env } from '../config/env.js';

const isProduction = env.NODE_ENV === 'production';
const isDevelopment = env.NODE_ENV === 'development';

// Custom log levels
const customLevels = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
  audit: 35 // Custom level for audit logs
};

// Create base logger configuration
const baseConfig = {
  level: env.LOG_LEVEL || 'info',
  customLevels,
  useOnlyCustomLevels: false,
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  formatters: {
    level: (label: string) => ({ level: label.toUpperCase() })
  }
};

// Development configuration (pretty printing)
const devConfig = {
  ...baseConfig,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
      levelFirst: true,
      messageFormat: '{msg}',
      customLevels: 'audit:35',
      customColors: 'audit:blue'
    }
  }
};

// Production configuration (JSON format)
const prodConfig = {
  ...baseConfig,
  serializers: {
    error: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res
  },
  messageKey: 'message',
  nestedKey: 'payload'
};

// Create logger instance
export const log = pino(isProduction ? prodConfig : devConfig);

// Custom audit logger
export const audit = (message: string, data?: any) => {
  log.info({ 
    ...data, 
    type: 'audit',
    message 
  }, `🔒 AUDIT: ${message}`);
};

// Request logger middleware
export const requestLogger = (req: any, res: any, next?: any) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.id,
      orgId: req.user?.org_id
    };
    
    if (res.statusCode >= 500) {
      log.error('Request error', logData);
    } else if (res.statusCode >= 400) {
      log.warn('Request warning', logData);
    } else {
      log.debug('Request completed', logData);
    }
  });
  
  if (next) next();
};

// Performance logger
export const perf = (operation: string, startTime: number, data?: any) => {
  const duration = Date.now() - startTime;
  log.debug({
    ...data,
    operation,
    duration,
    type: 'performance'
  }, `⏱️  ${operation} took ${duration}ms`);
};

// Database query logger
export const dbQuery = (query: string, params: any[] = [], duration: number, rows?: number) => {
  log.debug({
    query: query.substring(0, 200), // Limit query length
    params: params.length,
    duration,
    rows,
    type: 'database'
  }, `🗄️  Query executed in ${duration}ms`);
};

// Error logger with context
export const logError = (error: Error, context: any = {}) => {
  log.error({
    ...context,
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name
    },
    type: 'error'
  }, `❌ ${error.message}`);
};

// Business event logger
export const logBusinessEvent = (event: string, orgId: string, data?: any) => {
  log.info({
    ...data,
    event,
    orgId,
    type: 'business_event'
  }, `📊 ${event} - ${orgId}`);
};

// AI interaction logger
export const logAIInteraction = (
  type: 'voice' | 'sms' | 'whatsapp',
  orgId: string,
  interactionId: string,
  data?: any
) => {
  log.info({
    ...data,
    type: 'ai_interaction',
    interactionType: type,
    orgId,
    interactionId
  }, `🤖 ${type.toUpperCase()} interaction - ${orgId}`);
};

// Initialize logging
if (isDevelopment) {
  log.info('Logger initialized in development mode');
} else {
  log.info('Logger initialized in production mode', { 
    level: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV 
  });
}

// Export singleton
export default log;