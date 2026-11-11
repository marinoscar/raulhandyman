// =============================================================================
// The sharing slice's notifications and email templates
// =============================================================================
//
// `groups.invitation` and `sharing.shared_with_you`, both on `email` and
// `browser`, not mandatory. The events and the browser renderers are the
// slice's (`@marinoscar/platform-api/sharing`); the email templates are this
// app's bindings of the slice's renderers to its layout (`./*.email.ts`).
// Contributed to the notifications and email slices by `./sharing.slice.ts`.
// Pure data, no side effect.
// =============================================================================

import type { BrowserNotificationTemplate, NotificationRegistration } from '@marinoscar/platform-api/notifications';
import type { EmailTemplate, EmailTemplateEntry } from '@marinoscar/platform-api/email';
import {
  GROUPS_INVITATION_EVENT,
  GROUP_INVITATION_EMAIL_TEMPLATE,
  SHARED_WITH_YOU_EMAIL_TEMPLATE,
  SHARED_WITH_YOU_EVENT,
  groupInvitationBrowserTemplate,
  sharedWithYouBrowserTemplate,
} from '@marinoscar/platform-api/sharing';

import { groupInvitationEmail, type GroupInvitationEmailData } from './group-invitation.email';
import { sharedWithYouEmail, type SharedWithYouEmailData } from './shared-with-you.email';

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'group-invitation': GroupInvitationEmailData;
    'shared-with-you': SharedWithYouEmailData;
  }
}

export const SHARING_EMAIL_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: 'group-invitation', render: groupInvitationEmail as EmailTemplate<never>, registrant: 'sharing' },
  { name: 'shared-with-you', render: sharedWithYouEmail as EmailTemplate<never>, registrant: 'sharing' },
];

export const SHARING_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: GROUPS_INVITATION_EVENT.key,
      label: GROUPS_INVITATION_EVENT.label,
      description: GROUPS_INVITATION_EVENT.description,
      channels: [...GROUPS_INVITATION_EVENT.channels],
      defaultEnabled: GROUPS_INVITATION_EVENT.defaultEnabled,
    },
    emailTemplate: GROUP_INVITATION_EMAIL_TEMPLATE,
    browserTemplate: groupInvitationBrowserTemplate as BrowserNotificationTemplate,
  },
  {
    event: {
      key: SHARED_WITH_YOU_EVENT.key,
      label: SHARED_WITH_YOU_EVENT.label,
      description: SHARED_WITH_YOU_EVENT.description,
      channels: [...SHARED_WITH_YOU_EVENT.channels],
      defaultEnabled: SHARED_WITH_YOU_EVENT.defaultEnabled,
    },
    emailTemplate: SHARED_WITH_YOU_EMAIL_TEMPLATE,
    browserTemplate: sharedWithYouBrowserTemplate as BrowserNotificationTemplate,
  },
];
