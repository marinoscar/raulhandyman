// =============================================================================
// SHARING_DATA adapter: the sharing slice's way into the database
// =============================================================================
//
// The slice's three tables (`groups`, `group_members`, `group_invites`) force
// row-level security, so it has exactly two ways in, both this app's:
//
//   runInOrg     PrismaService.runInOrg: one transaction whose first statement
//                sets the transaction-local app.org_id / app.user_id. Every
//                request-driven query.
//   runAsSystem  PrismaSystemService.runAsSystem: the separate bypass pool, for
//                the user purge (`purge`), the read-only Doctor check
//                `sharing.groups.orphaned` (`doctor`), the grants prune job
//                (`retention`) and the one-row lookup of a link token by its
//                hash (`link-resolution`) and the lookup of the open invites to one
//                user's own address (`invite-claim`). Each names its reason.
// =============================================================================

import { Injectable } from '@nestjs/common';
import type { SharingDataPort, SharingSystemReason } from '@marinoscar/platform-api/sharing';

import { PrismaService } from '../../prisma/prisma.service';
import { PrismaSystemService } from '../../prisma/prisma-system.service';

@Injectable()
export class SharingDataAdapter implements SharingDataPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly system: PrismaSystemService,
  ) {}

  runInOrg<R>(scope: { orgId: string; userId?: string }, fn: (tx: unknown) => Promise<R>): Promise<R> {
    return this.prisma.runInOrg(scope.orgId, fn, scope.userId === undefined ? {} : { userId: scope.userId });
  }

  runAsSystem<R>(reason: SharingSystemReason, fn: (tx: unknown) => Promise<R>): Promise<R> {
    return this.system.runAsSystem(reason, fn);
  }
}
