import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { HashingService } from './HashingService';

@Injectable()
export class BcryptService implements HashingService {
  async hash(data: string): Promise<string> {
    return await bcrypt.hash(data, 10);
  }

  async compare(data: string, encrypted: string): Promise<boolean> {
    return await bcrypt.compare(data, encrypted);
  }
}
