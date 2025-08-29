import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/user/entities/user.entity';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/guards/auth.guard';
import { JWTService } from './auth/jwt.service';
import { BrowserFingerprintService } from './browser/browserFingerPrint.service';
import { BcryptService } from './hashing/BcryptService';
import { HashingService } from './hashing/HashingService';
import { RefreshTokenRotationService } from './auth/refreshTokenRotation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
  ],
  providers: [
    {
      provide: HashingService,
      useClass: BcryptService,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    AuthService,
    JWTService,
    BrowserFingerprintService,
    RefreshTokenRotationService,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class IamModule {}
