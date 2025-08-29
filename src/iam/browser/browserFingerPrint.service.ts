import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';

export interface BrowserFingerprint {
  userAgent: string;
  ipAddress: string;
  acceptLanguage?: string;
  acceptEncoding?: string;
  accept?: string;
}

@Injectable()
export class BrowserFingerprintService {
  generateFingerPrintId(req: Request): string {
    const fingerprint = this.extractFingerprintFromRequest(req);
    const fingerprintString = JSON.stringify({
      userAgent: fingerprint.userAgent,
      ipAddress: fingerprint.ipAddress,
      acceptLanguage: fingerprint.acceptLanguage,
      acceptEncoding: fingerprint.acceptEncoding,
      accept: fingerprint.accept,
    });

    return createHash('sha256')
      .update(fingerprintString)
      .digest('hex')
      .substring(0, 16);
  }

  extractFingerprintFromRequest(req: Request): BrowserFingerprint {
    return {
      userAgent: req.headers['user-agent'] || 'unknown',
      ipAddress: this.getClientIp(req),
      acceptLanguage: req.headers['accept-language'],
      acceptEncoding: req.headers['accept-encoding'],
      accept: req.headers['accept'],
    };
  }

  private getClientIp(req: Request): string {
    return (
      req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.headers['x-real-ip']?.toString() ||
      req.connection?.remoteAddress?.toString() ||
      req.socket?.remoteAddress?.toString() ||
      'unknown'
    );
  }
}