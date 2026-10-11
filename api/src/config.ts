export type DataAdapter = 'mock' | 'postgres';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface ApiConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly dataAdapter: DataAdapter;
  readonly databaseUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const dataAdapter = env.DATA_ADAPTER ?? 'mock';
  if (dataAdapter !== 'mock' && dataAdapter !== 'postgres') {
    throw new Error('DATA_ADAPTER must be mock or postgres');
  }
  if (nodeEnv === 'production' && dataAdapter === 'mock') {
    throw new Error('Mock data is forbidden in production; configure a real adapter before deployment');
  }

  const rawPort = env.PORT ?? '3001';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    throw new Error('LOG_LEVEL is invalid');
  }

  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) {
    throw new Error('HOST must not be blank');
  }

  return Object.freeze({
    nodeEnv: nodeEnv as ApiConfig['nodeEnv'],
    host,
    port,
    logLevel: logLevel as LogLevel,
    dataAdapter,
    ...(dataAdapter === 'postgres' && env.DATABASE_URL?.trim() ? { databaseUrl: env.DATABASE_URL.trim() } : {}),
  });
}
