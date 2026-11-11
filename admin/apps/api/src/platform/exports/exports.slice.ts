// The exports slice: signed, expiring downloads of a user's data (the Your data
// page, `/settings/data-export`) and of an organization's (offboarding), as
// JSON, CSV or XLSX, written to object storage by queue jobs. A source is a
// registration; `notes.export-source.ts` is the example.
import type { ApiSlice } from '../slices/slice';

export const exportsSlice: ApiSlice = {
  id: 'exports',
  contribute: () => {
    const exports = require('@marinoscar/platform-api/exports') as typeof import('@marinoscar/platform-api/exports');
    const { EXPORTS_NOTIFICATIONS } = require('./exports.notifications') as typeof import('./exports.notifications');
    // `exports/users/<userId>/` and `exports/orgs/<orgId>/`, so the standalone storage purge reaches them.
    return { notifications: EXPORTS_NOTIFICATIONS, storagePrefixes: exports.EXPORTS_KEY_PREFIXES };
  },
  register: () => {
    const exports = require('@marinoscar/platform-api/exports') as typeof import('@marinoscar/platform-api/exports');
    const userData = require('@marinoscar/platform-api/user-data') as typeof import('@marinoscar/platform-api/user-data');
    const { APP_EXPORT_SOURCES } = require('./notes.export-source') as typeof import('./notes.export-source');
    for (const source of APP_EXPORT_SOURCES) exports.registerExportSource(source);
    // An organization is not offboarded without a recent export of its data.
    userData.registerOffboardingPrecondition(userData.RECENT_ORG_EXPORT_PRECONDITION);
  },
  modules: () => {
    const { exportsModule } = require('./exports.config') as typeof import('./exports.config');
    return [exportsModule];
  },
};
