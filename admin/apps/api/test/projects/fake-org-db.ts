// A small in-memory stand-in for the organization-scoped Prisma transaction the
// projects services use (`PrismaService.runInOrg`): only the calls and `where`
// forms those services make. It proves the services' LOGIC (versions, slugs,
// ordering, publish) without a database; `projects.db.spec.ts` proves the same
// flows against real PostgreSQL and row-level security.
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

type Row = Record<string, any>;
type Where = Record<string, any> | undefined;

function matchesValue(actual: unknown, cond: any): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    if ('not' in cond) return actual !== cond.not;
    if ('has' in cond) return Array.isArray(actual) && actual.includes(cond.has);
    if ('in' in cond) return cond.in.includes(actual);
    if ('contains' in cond) return String(actual ?? '').toLowerCase().includes(String(cond.contains).toLowerCase());
  }
  return actual === cond;
}

export function matches(row: Row, where: Where): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((sub) => matches(row, sub));
    return matchesValue(row[key], cond);
  });
}

function sortRows(rows: Row[], orderBy: any): Row[] {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const spec of list) {
      const [[key, dir]] = Object.entries(spec) as [[string, string]];
      if (a[key] === b[key]) continue;
      return (a[key] < b[key] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

export class FakeOrgDb {
  projects: Row[] = [];
  photos: Row[] = [];
  state: Row[] = [];
  /** Statements run, for assertions. */
  calls: string[] = [];
  private clock = 0;
  /** The organization of the running scope: rows of any other organization are invisible, like row-level security. */
  private org = '';

  private vp = () => this.projects.filter((r) => r.orgId === this.org);
  private vph = () => this.photos.filter((r) => r.orgId === this.org);
  private vs = () => this.state.filter((r) => r.orgId === this.org);

  private stamp(): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++));
  }

  private applyUpdate(row: Row, data: Row): void {
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === 'object' && 'increment' in value) row[key] = (row[key] ?? 0) + value.increment;
      else row[key] = value;
    }
    row.updatedAt = this.stamp();
  }

  private withSelect(row: Row, select?: Row): Row {
    if (!select) return { ...row };
    const out: Row = {};
    for (const key of Object.keys(select)) {
      if (key === 'photos') out.photos = this.vph().filter((photo) => photo.projectId === row.id).map((photo) => ({ ...photo }));
      else out[key] = row[key];
    }
    return out;
  }

  readonly tx = {
    project: {
      findFirst: async ({ where, select }: Row) => {
        const row = this.vp().find((r) => matches(r, where));
        return row ? this.withSelect(row, select) : null;
      },
      findFirstOrThrow: async ({ where }: Row) => {
        const row = this.vp().find((r) => matches(r, where));
        if (!row) throw new Error('not found');
        return { ...row };
      },
      findMany: async ({ where, select, orderBy, skip, take }: Row) => {
        const rows = sortRows(this.vp().filter((r) => matches(r, where)), orderBy);
        return rows.slice(skip ?? 0, take === undefined ? undefined : (skip ?? 0) + take).map((r) => this.withSelect(r, select));
      },
      count: async ({ where }: Row) => this.vp().filter((r) => matches(r, where)).length,
      create: async ({ data }: Row) => {
        if (this.projects.some((r) => r.orgId === data.orgId && r.slug === data.slug)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        const now = this.stamp();
        const row: Row = {
          id: randomUUID(), previousSlugs: [], status: 'draft', title: '', workNotes: '', summary: '', body: '', seoTitle: '', metaDescription: '',
          completedOn: null, featured: false, coverPhotoId: null, publishedAt: null, version: 1, createdAt: now, updatedAt: now, ...data,
        };
        this.projects.push(row);
        return { ...row };
      },
      update: async ({ where, data }: Row) => {
        const row = this.vp().find((r) => matches(r, where))!;
        this.applyUpdate(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: Row) => {
        const rows = this.vp().filter((r) => matches(r, where));
        rows.forEach((row) => this.applyUpdate(row, data));
        return { count: rows.length };
      },
      delete: async ({ where }: Row) => {
        const row = this.vp().find((r) => matches(r, where))!;
        this.projects = this.projects.filter((r) => r !== row);
        this.photos = this.photos.filter((p) => p.projectId !== row.id);
        return row;
      },
    },
    projectPhoto: {
      findFirst: async ({ where, orderBy, select }: Row) => {
        const row = sortRows(this.vph().filter((r) => matches(r, where)), orderBy)[0];
        return row ? this.withSelect(row, select) : null;
      },
      findMany: async ({ where, orderBy, select }: Row) =>
        sortRows(this.vph().filter((r) => matches(r, where)), orderBy).map((r) => this.withSelect(r, select)),
      create: async ({ data }: Row) => {
        const now = this.stamp();
        const row: Row = {
          id: randomUUID(), sortOrder: 0, enhancedObjectId: null, retouchedObjectId: null, chosenVariant: 'enhanced', renditions: null, focalX: 0.5, focalY: 0.5,
          width: null, height: null, dominantColor: null, altText: '', caption: '', fileSlug: '', qualityFlags: [], privacyFlags: [], processingStatus: 'pending',
          processingError: null, aiRetouched: false, createdAt: now, updatedAt: now, ...data,
        };
        this.photos.push(row);
        return { ...row };
      },
      update: async ({ where, data }: Row) => {
        const row = this.vph().find((r) => matches(r, where))!;
        this.applyUpdate(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: Row) => {
        const rows = this.vph().filter((r) => matches(r, where));
        rows.forEach((row) => this.applyUpdate(row, data));
        return { count: rows.length };
      },
      delete: async ({ where }: Row) => {
        const row = this.vph().find((r) => matches(r, where))!;
        this.photos = this.photos.filter((r) => r !== row);
        return row;
      },
    },
    sitePublishState: {
      findFirst: async ({ where }: Row) => this.vs().find((r) => matches(r, where)) ?? null,
      upsert: async ({ where, create, update }: Row) => {
        this.calls.push('sitePublishState.upsert');
        const existing = this.vs().find((r) => matches(r, where));
        if (existing) Object.assign(existing, update);
        else this.state.push({ ...create });
      },
    },
  };

  /** Shaped like `PrismaService`: the services only call `runInOrg`. Records the org it was scoped to. */
  readonly prisma = {
    scopes: [] as string[],
    runInOrg: async <R>(orgId: string, fn: (tx: any) => Promise<R>): Promise<R> => {
      this.prisma.scopes.push(orgId);
      this.org = orgId;
      // Transaction semantics: a thrown error rolls the writes back.
      const snapshot = JSON.stringify({ p: this.projects, ph: this.photos, s: this.state });
      const restore = () => {
        const saved = JSON.parse(snapshot, (_k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));
        this.projects = saved.p;
        this.photos = saved.ph;
        this.state = saved.s;
      };
      try {
        return await fn(this.tx);
      } catch (error) {
        restore();
        throw error;
      }
    },
  };
}
