import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Redis } from 'ioredis';
import { BrowserFingerprint, BrowserFingerprintService } from '../browser/browserFingerPrint.service';

@Injectable()
export class RefreshTokenRotationService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly browserFingerprintService: BrowserFingerprintService,
    private readonly configService: ConfigService,
  ) {}

  private getSessionKey(userId: number, fingerprint: string): string {
    return `session:${userId}:${fingerprint}`;
  }

  private getUserSessionsKey(userId: number): string {
    return `user_sessions:${userId}`;
  }

  private getSessionTTLInSeconds(): number {
    const jwt_refresh_token_expiration_time = this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRATION_TIME') || '7d';
    
    const timeValue = parseInt(jwt_refresh_token_expiration_time);
    const timeUnit = jwt_refresh_token_expiration_time.replace(/[0-9]/g, '');
    
    let maxAgeInS: number;
    
    switch (timeUnit) {
      case 's':
        maxAgeInS = timeValue;
        break;
      case 'm':
        maxAgeInS = timeValue * 60;
        break;
      case 'h':
        maxAgeInS = timeValue * 60 * 60;
        break;
      case 'd':
        maxAgeInS = timeValue * 24 * 60 * 60;
        break;
      default:
        maxAgeInS = timeValue;
    }

    return maxAgeInS;
  }

  async rotateToken(
    newToken: string,
    userId: number,
    req: Request,
  ): Promise<void> {
    const fingerprintId = this.browserFingerprintService.generateFingerPrintId(req);
    const fingerprintPayload = this.browserFingerprintService.extractFingerprintFromRequest(req);
    const sessionKey = this.getSessionKey(userId, fingerprintId);
    const userSessionsKey = this.getUserSessionsKey(userId);

    // Store the new session
    await this.redis.setex(
      sessionKey,
      this.getSessionTTLInSeconds(),
      JSON.stringify({
        refreshToken: newToken,
        fingerprint: fingerprintPayload,
      })
    );

    // Add fingerprint to user sessions set and update expiration
    await this.redis.sadd(userSessionsKey, fingerprintId);
    await this.redis.expire(userSessionsKey, this.getSessionTTLInSeconds());
  }

  async compareToken(
    token: string, 
    userId: number, 
    req: Request
  ): Promise<boolean> {
    const fingerprintId = this.browserFingerprintService.generateFingerPrintId(req);
    const sessionKey = this.getSessionKey(userId, fingerprintId);
    const storedSession = await this.redis.get(sessionKey);
    if (!storedSession) {
      return false;
    }
    const session: { refreshToken: string } = JSON.parse(storedSession);
    return session.refreshToken === token;
  }

  async invalidateToken(userId: number, req: Request): Promise<void> {
    const fingerprintId = this.browserFingerprintService.generateFingerPrintId(req);
    const sessionKey = this.getSessionKey(userId, fingerprintId);
    const userSessionsKey = this.getUserSessionsKey(userId);

    await this.redis.del(sessionKey);
    await this.redis.srem(userSessionsKey, fingerprintId);
  }

  async invalidateAllUserSessions(userId: number): Promise<void> {
    const userSessionsKey = this.getUserSessionsKey(userId);
    const fingerprints = await this.redis.smembers(userSessionsKey);

    if (fingerprints.length > 0) {
      const pipeline = this.redis.pipeline();
      
      fingerprints.forEach(fingerprintId => {
        const sessionKey = this.getSessionKey(userId, fingerprintId);
        pipeline.del(sessionKey);
      });
      
      pipeline.del(userSessionsKey);
      
      await pipeline.exec();
    }
  }

  async getUserSessions(userId: number): Promise<BrowserFingerprint[]> {
    const userSessionsKey = this.getUserSessionsKey(userId);
    const fingerprints = await this.redis.smembers(userSessionsKey);
    
    if (fingerprints.length === 0) return [];

    const sessions: BrowserFingerprint[] = [];
    const invalidFingerprints: string[] = [];
    
    for (const fingerprintId of fingerprints) {
      const sessionKey = this.getSessionKey(userId, fingerprintId);
      const sessionData = await this.redis.get(sessionKey);
      
      if (sessionData) {
        try {
          const parsedSession = JSON.parse(sessionData);
          sessions.push(parsedSession.fingerprint as BrowserFingerprint);
        } catch (error) {
          // Invalid JSON data, mark for cleanup
          invalidFingerprints.push(fingerprintId);
        }
      } else {
        // Session expired or missing, mark for cleanup
        invalidFingerprints.push(fingerprintId);
      }
    }

    // Clean up invalid fingerprints from user sessions set
    if (invalidFingerprints.length > 0) {
      await this.redis.srem(userSessionsKey, ...invalidFingerprints);
    }

    return sessions;
  }

  async sessionExists(userId: number, req: Request): Promise<boolean> {
    const fingerprintId = this.browserFingerprintService.generateFingerPrintId(req);
    const sessionKey = this.getSessionKey(userId, fingerprintId);
    return await this.redis.exists(sessionKey) === 1;
  }
}