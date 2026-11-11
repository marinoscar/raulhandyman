// =============================================================================
// SHARING_NOTIFIER adapter: group invitations through the app's notifications
//
// =============================================================================
//
// A thin pass-through to `NotificationsService` that adds the absolute sign-in
// URL (`APP_URL`) the e-mail's button points at, exactly as the organization
// invitation does. Called by the slice after the invite's transaction
// committed, outside it.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SharingNotifier } from '@marinoscar/platform-api/sharing';

import { NotificationsService } from '@marinoscar/platform-api/notifications';

@Injectable()
export class SharingNotifierAdapter implements SharingNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  private withSignInUrl(data: unknown): unknown {
    const appUrl = this.config.get<string>('appUrl');
    if (!appUrl || data === null || typeof data !== 'object') return data;
    const base = appUrl.replace(/\/+$/, '');
    const fields = data as Record<string, unknown>;
    // A share notification links to the record when its type gives a
    // root-relative path, otherwise to the sign-in page.
    const path = typeof fields.path === 'string' && fields.path.startsWith('/') && !fields.path.startsWith('//') ? fields.path : null;
    return { ...fields, signInUrl: `${base}/login`, ...(path ? { openUrl: `${base}${path}` } : {}) };
  }

  notify(eventKey: string, userId: string, data: unknown): Promise<void> {
    return this.notifications.notify(eventKey, userId, this.withSignInUrl(data));
  }

  notifyAddress(eventKey: string, email: string, data: unknown): Promise<void> {
    return this.notifications.notifyAddress(eventKey, email, this.withSignInUrl(data));
  }
}
