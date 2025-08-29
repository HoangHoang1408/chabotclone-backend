import { IsString } from 'class-validator';

export class AuthOutput {
  @IsString()
  accessToken: string;
}

export class SignOutOutput {
  @IsString()
  message: string;
}