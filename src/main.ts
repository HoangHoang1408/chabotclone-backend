import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Add cookie parser middleware
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove extra properties
      transform: true, // transform the payload to the DTO type
      forbidNonWhitelisted: true, // throw an error if a non-whitelisted property is sent
      skipMissingProperties: false, // require all fields to be present
    }),
  );
  await app.listen(configService.get('port') ?? 3000);
}
bootstrap();
