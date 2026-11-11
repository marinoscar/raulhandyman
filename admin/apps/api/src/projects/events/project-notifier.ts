import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '@marinoscar/platform-api/notifications';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Sends the project and site notifications through the notifications slice and
 * finds their recipients. Recipients are resolved INSIDE the organization (the
 * platform's own permission-holder helper reads system role grants only, and
 * `content_editor` and `org_admin` are organization roles held through
 * memberships). Every call is best-effort: a failure is logged and never
 * reaches the caller, which runs after its own write committed.
 *
 * Without the notifications slice (`NotificationsService` absent) it does
 * nothing.
 */
@Injectable()
export class ProjectNotifier {
  private readonly logger = new Logger(ProjectNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** The absolute URL of an in-app path, or the path itself when the app URL is not configured. */
  appLink(path: string): string {
    const base = (this.config?.get<string>('appUrl') ?? '').replace(/\/+$/, '');
    return `${base}${path}`;
  }

  /** Active members of the organization whose role grants `permission` (an active account only). */
  holdersOf(orgId: string, permission: string): Promise<string[]> {
    return this.members(orgId, { role: { rolePermissions: { some: { permission: { name: permission } } } } });
  }

  /** Active organization administrators (`org_admin`). */
  adminsOf(orgId: string): Promise<string[]> {
    return this.members(orgId, { role: { name: 'org_admin' } });
  }

  private async members(orgId: string, where: Record<string, unknown>): Promise<string[]> {
    try {
      const rows = await this.prisma.membership.findMany({
        where: { orgId, status: 'active', user: { isActive: true }, ...where },
        select: { userId: true },
      });
      return [...new Set(rows.map((row) => row.userId))];
    } catch (error) {
      this.logger.error(`recipient lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /** Sends one event to each user. Awaited (the caller is a job or a request that already committed). */
  async send(eventKey: string, orgId: string, userIds: readonly (string | null | undefined)[], data: Record<string, unknown>): Promise<void> {
    if (!this.notifications) return;
    for (const userId of new Set(userIds.filter((id): id is string => Boolean(id)))) {
      try {
        await this.notifications.notifyNow(eventKey, userId, data, { orgId });
      } catch (error) {
        this.logger.warn(`${eventKey} to a user failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
