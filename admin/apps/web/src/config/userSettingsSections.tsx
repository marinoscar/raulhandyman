import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import { identityUserSettingsSections } from '@marinoscar/platform-web/identity/ui';
import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';
import { DANGER_ZONE_GROUP_LABEL } from '@marinoscar/platform-web/user-data/headless';
import { dangerZoneSettingsPage } from '@marinoscar/platform-web/user-data/ui';

import { sliceUserCards } from '../slices/manifest';
import { composeSections } from '../slices/sections';

/**
 * The core's per-user groups. `Account` is empty on purpose: the optional
 * slices (`packages/shared/slices.json`) append to it (Profile, Notifications,
 * Get started) and to `Security` (AI keys), and add their own groups (Sharing,
 * Your data) before the Danger Zone.
 */
const CORE_USER_SECTIONS: SettingsSectionDef[] = [
  { label: 'Account', cards: [] },
  { label: 'Security', cards: [...identityUserSettingsSections.security] },
  {
    label: 'Notes',
    cards: [
      {
        title: 'My notes',
        description: 'Write, archive and delete your own notes.',
        Icon: StickyNote2OutlinedIcon,
        path: '/notes',
        permission: 'notes:read',
      },
    ],
  },
  // `Danger Zone` stays LAST (docs/specs/settings-ui.md): add new groups above it.
  { label: DANGER_ZONE_GROUP_LABEL, cards: [{ ...dangerZoneSettingsPage.card, Icon: dangerZoneSettingsPage.Icon }] },
];

/**
 * The per-user settings hub (`/settings`). The sample card is the app's own:
 * `notes:read` is the permission `GET /api/notes` enforces
 * (apps/api/src/notes/notes.controller.ts). APPEND new cards; an optional
 * slice's card is declared in `src/slices/<id>.tsx`.
 */
export const USER_SETTINGS_SECTIONS: SettingsSectionDef[] = composeSections(CORE_USER_SECTIONS, sliceUserCards);
