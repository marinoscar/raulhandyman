// The exports slice, on the web: the "Your data" page, where a user requests an
// export of their data (the platform's `user-data` source plus this app's
// sources, e.g. the notes source) and downloads the finished file from a signed,
// expiring link. Any signed-in user may open it; each source names the
// permission it needs.
import { dataExportSettingsPage } from '@marinoscar/platform-web/exports/ui';
import { lazy } from 'react';

import type { WebSlice } from './slice';

const DataExportPage = lazy(() => import('@marinoscar/platform-web/exports/ui').then((m) => ({ default: m.DataExportPage })));

export const exportsWebSlice: WebSlice = {
  id: 'exports',
  routes: [{ path: 'settings/data-export', element: <DataExportPage /> }],
  userCards: [{ group: 'Your data', cards: [{ ...dataExportSettingsPage.card, Icon: dataExportSettingsPage.Icon }] }],
};
