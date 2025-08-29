import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JWTService } from '../jwt.service';

import { UserRole } from 'src/user/entities/user.entity';

const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
export interface RequestUser {
  id: number;
  email: string;
  role: UserRole;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JWTService
  ) {
  }

  async canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles === undefined) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.split(' ')[1];
    if (!token) {
      throw new UnauthorizedException('No token provided');
    }
    try {
      const payload = await this.jwtService.verifyToken(token, 'access');
      if (!payload) {
        throw new UnauthorizedException('Invalid credentials');
      }
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      }
    } catch (error) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (roles.length === 0) {
      return true;
    }
    return roles.some((role) => request.user.role === role);
  } 
}

