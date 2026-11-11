import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Principal } from '@marinoscar/platform-api/core';
import {
  AccessPolicy,
  GrantsService,
  PrincipalGroupsProvider,
  accessibleWhere,
  resourceKey,
} from '@marinoscar/platform-api/sharing';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { DOCUMENT_TYPE } from './document.resource-type';
import type { CreateDocumentDto, UpdateDocumentDto } from './documents.schemas';

/** A document as the API returns it, with the caller's effective role on it. */
export interface DocumentView {
  id: string;
  title: string;
  body: string;
  ownerUserId: string;
  role: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT = { id: true, title: true, body: true, ownerUserId: true, createdAt: true, updatedAt: true } as const;

/**
 * The sample records' rules, in the order the sharing README prescribes: every
 * route that acts on ONE record asks `AccessPolicy.require` first (it throws
 * the type's refusal: 404, the same body as a missing record); a LIST asks
 * `accessibleWhere` for the records the caller may see and filters in the same
 * org-scoped transaction; a delete removes the record's grants in the SAME
 * transaction (`GrantsService.deleteForResources`), so no grant dangles.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AccessPolicy) private readonly access: AccessPolicy,
    @Inject(GrantsService) private readonly grants: GrantsService,
    @Inject(PrincipalGroupsProvider) private readonly principalGroups: PrincipalGroupsProvider,
  ) {}

  /** A document belongs to the caller's ACTIVE organization. */
  private orgOf(principal: Principal): string {
    if (!principal.activeOrgId) throw new BadRequestException('Select an organization first');
    return principal.activeOrgId;
  }

  async create(principal: Principal, input: CreateDocumentDto): Promise<DocumentView> {
    const orgId = this.orgOf(principal);
    const row = await this.prisma.runInOrg(
      orgId,
      (tx) => tx.document.create({ data: { orgId, ownerUserId: principal.userId, title: input.title, body: input.body ?? '' }, select: SELECT }),
      { userId: principal.userId },
    );
    return { ...row, role: 'owner' };
  }

  /** The documents the caller may read, newest first. `scope`: `owned`, `shared` or `all`. */
  async list(principal: Principal, scope: 'owned' | 'shared' | 'all' = 'all'): Promise<DocumentView[]> {
    const orgId = this.orgOf(principal);
    const me = await this.principalGroups.enrich(principal);
    const rows = await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        const access = await accessibleWhere(me, DOCUMENT_TYPE, { tx, sqlKit: Prisma, scope });
        if (access.form === 'where') return tx.document.findMany({ where: access.where, select: SELECT, orderBy: { createdAt: 'desc' } });
        // Above 1,000 shared records the helper hands back an EXISTS condition instead of an id list.
        const ids = await tx.$queryRaw<Array<{ id: string }>>`SELECT r.id::text AS id FROM documents r WHERE ${access.sql} ORDER BY r.created_at DESC`;
        return tx.document.findMany({ where: { id: { in: ids.map((row) => row.id) } }, select: SELECT, orderBy: { createdAt: 'desc' } });
      },
      { userId: principal.userId },
    );
    // ONE batched decision for the page, for the role each row shows.
    const decisions = await this.access.decideMany(me, 'read', rows.map((row) => ({ type: DOCUMENT_TYPE, id: row.id })));
    return rows.map((row) => ({ ...row, role: decisions.get(resourceKey({ type: DOCUMENT_TYPE, id: row.id }))?.role ?? null }));
  }

  /** One document, or the type's refusal (404) unless the caller may read it. */
  async get(principal: Principal, id: string): Promise<DocumentView> {
    const orgId = this.orgOf(principal);
    const decision = await this.access.require(principal, 'read', { type: DOCUMENT_TYPE, id });
    const row = await this.prisma.runInOrg(orgId, (tx) => tx.document.findFirstOrThrow({ where: { id }, select: SELECT }), { userId: principal.userId });
    return { ...row, role: decision.role };
  }

  /** Editor or owner. */
  async update(principal: Principal, id: string, patch: UpdateDocumentDto): Promise<DocumentView> {
    const orgId = this.orgOf(principal);
    const decision = await this.access.require(principal, 'write', { type: DOCUMENT_TYPE, id });
    const row = await this.prisma.runInOrg(orgId, (tx) => tx.document.update({ where: { id }, data: patch, select: SELECT }), { userId: principal.userId });
    return { ...row, role: decision.role };
  }

  /** Owner only. The grants go in the same transaction. */
  async remove(principal: Principal, id: string): Promise<void> {
    const orgId = this.orgOf(principal);
    await this.prisma.runInOrg(
      orgId,
      async (tx) => {
        await this.access.requireIn(tx, principal, 'delete', { type: DOCUMENT_TYPE, id });
        await this.grants.deleteForResources(tx, DOCUMENT_TYPE, [id]);
        await tx.document.delete({ where: { id } });
      },
      { userId: principal.userId },
    );
  }
}
