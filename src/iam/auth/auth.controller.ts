import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { User } from 'src/user/entities/user.entity';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthOutput, SignOutOutput } from './dto/auth.dto';
import { SignInInput } from './dto/signin.dto';
import { SignUpInput } from './dto/signup.dto';
import { Roles } from './guards/auth.guard';


@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  
  @Post('sign-up')
  async signUp(@Body() signUpDto: SignUpInput, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthOutput> {
    const result = await this.authService.signUp(signUpDto, req, res);
    return { accessToken: result.accessToken };
  }

  @Post('sign-in')
  async signIn(@Body() signInDto: SignInInput, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthOutput> {
    const result = await this.authService.signIn(signInDto, req, res);
    
    return { accessToken: result.accessToken };
  }

  @Post('refresh')
  async refreshToken(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthOutput> {
    const result = await this.authService.refreshTokens(req, res);
    return { accessToken: result.accessToken };
  }

  @Roles()
  @Get('profile')
  getProfile(@CurrentUser() user: User) {
    return user;
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SignOutOutput> {
    await this.authService.signOut(req, res);
    return { message: 'Logged out successfully' };
  }

  @Post('sign-out')
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SignOutOutput> {
    await this.authService.signOut(req, res);
    return { message: 'Signed out successfully' };
  }

  @Post('sign-out-all')
  async signOutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SignOutOutput> {
    await this.authService.signOutAll(req, res);
    return { message: 'Signed out from all sessions successfully' };
  }
}
