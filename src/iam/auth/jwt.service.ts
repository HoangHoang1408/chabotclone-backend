import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { UserRole } from 'src/user/entities/user.entity';

export interface TokenPayload {
  sub: number;
  email: string;
  role: UserRole;
  type: 'access' | 'refresh';
}

@Injectable()
export class JWTService {
  constructor(private readonly configService: ConfigService) {
  }

  async signToken(payload: TokenPayload): Promise<string> {
    const { sub, email, role, type } = payload;
    const typeUpper = type.toUpperCase();
    const secret = this.configService.get<string>(`JWT_${typeUpper}_TOKEN_SECRET`);
    const expiresIn = this.configService.get<string>(`JWT_${typeUpper}_TOKEN_EXPIRATION_TIME`);
    
    if (!secret) {
      throw new Error(`JWT_${typeUpper}_TOKEN_SECRET is not configured`);
    }
    
    if (!expiresIn) {
      throw new Error(`JWT_${typeUpper}_TOKEN_EXPIRATION_TIME is not configured`);
    }
    return jwt.sign(
      { sub, email, role, type }, 
      secret, 
      { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] }
    );
  }

  async verifyToken(token: string, type: 'access' | 'refresh' = 'access'): Promise<TokenPayload> {
    const typeUpper = type.toUpperCase();
    const secret = this.configService.get<string>(`JWT_${typeUpper}_TOKEN_SECRET`);
    
    if (!secret) {
      throw new Error(`JWT_${typeUpper}_TOKEN_SECRET is not configured`);
    }
    
    const decoded = jwt.verify(token, secret);
    if (typeof decoded === 'string') {
      throw new Error('Invalid token format');
    }
    
    if (!decoded || typeof decoded !== 'object' || !('sub' in decoded) || !('email' in decoded) || !('role' in decoded) || !('type' in decoded)) {
      throw new Error('Invalid token payload');
    }
    
    return decoded as unknown as TokenPayload;
  }

  async decodeToken(token: string): Promise<TokenPayload | null> {
    try {
      const decoded = jwt.decode(token);
      if (typeof decoded === 'string' || decoded === null) {
        return null;
      }
      
      if (!decoded || typeof decoded !== 'object' || !('sub' in decoded) || !('email' in decoded) || !('role' in decoded) || !('type' in decoded)) {
        return null;
      }
      
      return decoded as unknown as TokenPayload;
    } catch (error) {
      return null;
    }
  }

  async generateTokenPair(payload: Omit<TokenPayload, 'type'>): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.signToken({ ...payload, type: 'access' });
    const refreshToken = await this.signToken({ ...payload, type: 'refresh' });
    
    return { accessToken, refreshToken };
  }
}

