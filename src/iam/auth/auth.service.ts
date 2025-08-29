import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { User } from 'src/user/entities/user.entity';
import { Repository } from 'typeorm';
import { HashingService } from '../hashing/HashingService';
import { AuthOutput, SignOutOutput } from './dto/auth.dto';
import { SignInInput } from './dto/signin.dto';
import { SignUpInput } from './dto/signup.dto';
import { JWTService } from './jwt.service';
import { RefreshTokenRotationService } from './refreshTokenRotation.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {  
  constructor(
    private readonly hashingService: HashingService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly jwtService: JWTService,
    private readonly refreshTokenRotationService: RefreshTokenRotationService
  ) {}

  async signUp(signUpInput: SignUpInput, req: Request, res: Response): Promise<AuthOutput> {
    const { email, password } = signUpInput;
    
    const existingUser = await this.userRepository.findOne({ where: { email } });
    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    const hashedPassword = await this.hashingService.hash(password);
    const newUser = this.userRepository.create({ email, password: hashedPassword });
    const savedUser = await this.userRepository.save(newUser);
    
    const tokens = await this.jwtService.generateTokenPair({ sub: savedUser.id, email: savedUser.email, role: savedUser.role });
    await this.refreshTokenRotationService.rotateToken(tokens.refreshToken, savedUser.id, req);
    this.setCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  async signIn(signInInput: SignInInput, req: Request, res: Response): Promise<AuthOutput> {
    const { email, password } = signInInput;
    
    const user = await this.userRepository.findOne({ 
      where: { email }, 
      select: ['id', 'email', 'password', 'role'] 
    });
    
    if (!user || !(await this.hashingService.compare(password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.jwtService.generateTokenPair({ sub: user.id, email: user.email, role: user.role });
    await this.refreshTokenRotationService.rotateToken(tokens.refreshToken, user.id, req);
    this.setCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  async refreshTokens(req: Request, res: Response): Promise<AuthOutput> {
    const refreshToken = res.req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token not found');
    }

    try {
      // Verify JWT signature and expiration
      const payload = await this.jwtService.verifyToken(refreshToken, 'refresh');
      
      // Verify token exists in Redis storage (refresh token rotation security)
      const isValidSession = await this.refreshTokenRotationService.compareToken(
        refreshToken, 
        payload.sub, 
        req
      );
      
      if (!isValidSession) {
        this.clearCookie(res);
        throw new UnauthorizedException('Invalid refresh token session');
      }

      const tokens = await this.jwtService.generateTokenPair({ 
        sub: payload.sub, 
        email: payload.email, 
        role: payload.role 
      });
      
      await this.refreshTokenRotationService.rotateToken(tokens.refreshToken, payload.sub, req);
      this.setCookie(res, tokens.refreshToken);
      return { accessToken: tokens.accessToken };
    } catch (error) {
      this.clearCookie(res);
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async signOut(req: Request, res: Response): Promise<SignOutOutput> {
    const refreshToken = res.req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token not found');
    }
    const payload = await this.jwtService.verifyToken(refreshToken, 'refresh');
    await this.refreshTokenRotationService.invalidateToken(payload.sub, req);
    this.clearCookie(res);
    return { message: 'Signed out successfully' };
  }

  async signOutAll(req: Request, res: Response): Promise<SignOutOutput> {
    const refreshToken = res.req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new BadRequestException('Refresh token not found');
    }
    const payload = await this.jwtService.verifyToken(refreshToken, 'refresh');
    await this.refreshTokenRotationService.invalidateAllUserSessions(payload.sub);
    this.clearCookie(res);
    return { message: 'Signed out from all sessions successfully' };
  }

  async validateToken(token: string, type: 'access' | 'refresh' = 'access'): Promise<boolean> {
    try {
      const payload = await this.jwtService.verifyToken(token, type);
      if (payload.type !== type) {
        throw new UnauthorizedException('Invalid token type');
      }
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private setCookie(res: Response, token: string): void {
    const jwt_refresh_token_expiration_time = this.configService.get<string>('JWT_REFRESH_TOKEN_EXPIRATION_TIME') || '7d';
    
    const timeValue = parseInt(jwt_refresh_token_expiration_time);
    const timeUnit = jwt_refresh_token_expiration_time.replace(/[0-9]/g, '');
    
    let maxAgeInMs: number;
    
    switch (timeUnit) {
      case 's':
        maxAgeInMs = timeValue * 1000;
        break;
      case 'm':
        maxAgeInMs = timeValue * 60 * 1000;
        break;
      case 'h':
        maxAgeInMs = timeValue * 60 * 60 * 1000;
        break;
      case 'd':
        maxAgeInMs = timeValue * 24 * 60 * 60 * 1000;
        break;
      default:
        maxAgeInMs = timeValue * 1000;
    }
    
    const cookieOptions = {
      httpOnly: false,
      secure: false,
      sameSite: 'lax' as const,
      path: '/auth/refresh',
      maxAge: maxAgeInMs,
      expires: new Date(Date.now() + maxAgeInMs)
    };
    this.clearCookie(res);
    res.cookie('refreshToken', token, cookieOptions);
  }

  private clearCookie(res: Response): void {
    res.clearCookie('refreshToken');
  }
}
