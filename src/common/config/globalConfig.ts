export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  auth: {
    jwtSecret: process.env.JWT_ACCESS_TOKEN_SECRET,
    jwtExpirationTime: process.env.JWT_ACCESS_TOKEN_EXPIRATION_TIME,
    jwtRefreshTokenSecret: process.env.JWT_REFRESH_TOKEN_SECRET,
    jwtRefreshTokenExpirationTime: process.env.JWT_REFRESH_TOKEN_EXPIRATION_TIME,
  },
  database: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  brave: {
    apiKey: process.env.BRAVE_SEARCH_API_KEY,
  },
  bullmq: {
    chatAgentConcurrency: parseInt(process.env.BULLMQ_CHAT_AGENT_CONCURRENCY || '10', 10),
    maxStalledCount: parseInt(process.env.BULLMQ_MAX_STALLED_COUNT || '1', 10),
    maxStalledInterval: parseInt(process.env.BULLMQ_MAX_STALLED_INTERVAL || '10000', 10),
  },
  stream: {
    ttl: parseInt(process.env.STREAM_TTL || '600', 10),
    errorTtl: parseInt(process.env.STREAM_ERROR_TTL || '60', 10),
    maxIdleTime: parseInt(process.env.STREAM_MAX_IDLE_TIME || '120', 10),
  },
}); 