import { RedisModule } from '@nestjs-modules/ioredis';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import globalConfig from './common/config/globalConfig';
import { IamModule } from './iam/iam.module';
import { UserModule } from './user/user.module';
import { ChatAgentsModule } from './chat_agents/chatAgents.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [globalConfig],
      envFilePath: `.env.${process.env.NODE_ENV || 'dev'}`,
      ignoreEnvFile: process.env.NODE_ENV === 'production',
      validationSchema: Joi.object({
        PORT: Joi.number().required(),
        JWT_ACCESS_TOKEN_SECRET: Joi.string().required(),
        JWT_ACCESS_TOKEN_EXPIRATION_TIME: Joi.string().required(),
        JWT_REFRESH_TOKEN_SECRET: Joi.string().required(),
        JWT_REFRESH_TOKEN_EXPIRATION_TIME: Joi.string().required(),
        DATABASE_HOST: Joi.string().required(),
        DATABASE_PORT: Joi.number().required(),
        DATABASE_USERNAME: Joi.string().required(),
        DATABASE_PASSWORD: Joi.string().required(),
        DATABASE_NAME: Joi.string().required(),
        REDIS_HOST: Joi.string().required(),
        REDIS_PORT: Joi.number().required(),
        REDIS_PASSWORD: Joi.string().required(),
        REDIS_DB: Joi.number().required(),
        OPENAI_API_KEY: Joi.string().required(),
        BULLMQ_CHAT_AGENT_CONCURRENCY: Joi.number().required(),
        BULLMQ_MAX_STALLED_COUNT: Joi.number().required(),
        BULLMQ_MAX_STALLED_INTERVAL: Joi.number().required(),
        BRAVE_SEARCH_API_KEY: Joi.string().required(),
        STREAM_TTL: Joi.number().required(),
        STREAM_ERROR_TTL: Joi.number().required(),
        STREAM_MAX_IDLE_TIME: Joi.number().required(),
      }),
      validationOptions: {
        abortEarly: true,
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: process.env.NODE_ENV === 'dev',
        logging: process.env.NODE_ENV === 'dev',
      }),
    }),
    RedisModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        config: {
          host: configService.get('redis.host'),
          port: configService.get('redis.port'),
          password: configService.get('redis.password'),
          db: configService.get('redis.db'),
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('redis.host'),
          port: configService.get('redis.port'),
          password: configService.get('redis.password'),
          db: configService.get('redis.db'),
        },
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: true,
        },
        defaultWorkerOptions: {
          concurrency: configService.get('bullmq.chatAgentConcurrency'),
          maxStalledCount: configService.get('bullmq.maxStalledCount'),
          stalledInterval: configService.get('bullmq.maxStalledInterval'),
        },
      }),
    }),
    UserModule,
    IamModule,
    ChatAgentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
