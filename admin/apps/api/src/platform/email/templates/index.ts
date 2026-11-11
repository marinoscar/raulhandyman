import type { EmailTemplate, EmailTemplateEntry } from '@marinoscar/platform-api/email';

import { notesArchivedEmail, type NotesArchivedEmailData } from './notes-archived.email';
import { orgInvitationEmail, type OrgInvitationEmailData } from './org-invitation.email';

// =============================================================================
// Email templates this app owns the words of
// =============================================================================
//
// `org-invitation` (the identity slice's organization invitation: the platform
// ships the other nine) and the sample feature's `notes-archived`. A template
// name is a stable id: notification events map to it. The typed data map below
// is what makes `renderEmailTemplate('notes-archived', data)` check its data.
// Registered by the email slice (`../email.slice.ts`) at import time, never
// from `onModuleInit`.
// =============================================================================

declare module '@marinoscar/platform-api/email' {
  interface EmailTemplateDataMap {
    'org-invitation': OrgInvitationEmailData;
    'notes-archived': NotesArchivedEmailData;
  }
}

/** The templates the email slice registers, after the platform's nine. */
export const EMAIL_SLICE_TEMPLATES: readonly EmailTemplateEntry[] = [
  { name: 'org-invitation', render: orgInvitationEmail as EmailTemplate<never>, registrant: 'identity' },
  { name: 'notes-archived', render: notesArchivedEmail as EmailTemplate<never>, registrant: 'notes' },
];

export { notesArchivedEmail, orgInvitationEmail };
export type { NotesArchivedEmailData, OrgInvitationEmailData };
