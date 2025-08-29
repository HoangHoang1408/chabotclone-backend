import { Injectable } from '@nestjs/common';

@Injectable()
export abstract class HashingService {
  async hash(data: string): Promise<string> {
    throw new Error('Not implemented');
  }

  async compare(data: string, encrypted: string): Promise<boolean> {
    throw new Error('Not implemented');
  }
}