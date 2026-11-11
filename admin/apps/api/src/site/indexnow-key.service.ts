import { Injectable, Logger } from '@nestjs/common';
import { CredentialsService } from '@marinoscar/platform-api/credentials';
import { randomBytes } from 'node:crypto';

import { SITE_ORIGIN } from './site-changed-urls';

/** The credential purpose of the IndexNow key. Permanent once a row exists. */
export const INDEXNOW_CREDENTIAL_PURPOSE = 'site.indexnow_key';
export const INDEXNOW_CREDENTIAL_NAME = 'default';

export interface IndexNowKeyStatus {
  configured: boolean;
  /** The key itself. An IndexNow key is PUBLIC by design (the site serves it at `keyLocation`), so showing it is safe. */
  key: string | null;
  keyLocation: string | null;
  updatedAt: string | null;
}

export const keyLocationOf = (key: string): string => `${SITE_ORIGIN}/${key}.txt`;

/**
 * The IndexNow key, kept in the encrypted credential store (deployment tier)
 * like every other runtime-configured credential. Unlike other secrets it is
 * public by design: search engines fetch it from `https://<host>/<key>.txt` to
 * prove the site owner sent the ping, so the manifest publishes it
 * (`indexNowKey`) and the settings card may display it.
 */
@Injectable()
export class IndexNowKeyService {
  private readonly logger = new Logger(IndexNowKeyService.name);

  constructor(private readonly credentials: CredentialsService) {}

  /** The configured key, or null. */
  get(): Promise<string | null> {
    return this.credentials.getSecret(INDEXNOW_CREDENTIAL_PURPOSE, INDEXNOW_CREDENTIAL_NAME);
  }

  async status(): Promise<IndexNowKeyStatus> {
    const [key, info] = await Promise.all([this.get(), this.credentials.describe(INDEXNOW_CREDENTIAL_PURPOSE, INDEXNOW_CREDENTIAL_NAME)]);
    return { configured: key !== null, key, keyLocation: key ? keyLocationOf(key) : null, updatedAt: info?.updatedAt ? new Date(info.updatedAt).toISOString() : null };
  }

  /** Generates a fresh 32-hex-character key (replacing any existing one). */
  async generate(userId: string): Promise<IndexNowKeyStatus> {
    const key = randomBytes(16).toString('hex');
    await this.credentials.setSecret(INDEXNOW_CREDENTIAL_PURPOSE, INDEXNOW_CREDENTIAL_NAME, key, { label: 'IndexNow key', updatedByUserId: userId });
    this.logger.log(`site.indexnow_key generated userId=${userId}`);
    return this.status();
  }

  async clear(userId: string): Promise<void> {
    await this.credentials.deleteSecret(INDEXNOW_CREDENTIAL_PURPOSE, INDEXNOW_CREDENTIAL_NAME);
    this.logger.log(`site.indexnow_key cleared userId=${userId}`);
  }
}
