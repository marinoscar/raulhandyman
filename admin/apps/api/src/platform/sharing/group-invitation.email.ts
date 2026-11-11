import {
  renderGroupInvitationEmail,
  type GroupInvitationNotificationData,
} from '@marinoscar/platform-api/sharing';

import {
  SafeHtml,
  TRANSACTIONAL_EMAIL_HEADERS,
  html,
  plainText,
  renderLayout,
  resolveEmailRenderContext,
  type EmailRenderContext,
  type RenderedEmail,
} from '@marinoscar/platform-api/email';

// =============================================================================
// "Invitation to a group" template — `groups.invitation`
// =============================================================================
//
// The words are the sharing slice's (`renderGroupInvitationEmail` in
// `@marinoscar/platform-api/sharing`); the layout, the escaping `html` tag and
// the plain-text renderer are this app's, so the message looks like every
// other one it sends. The group name is user-typed: every interpolation goes
// through `html`, which escapes it, and the name stays out of the subject.
// =============================================================================

/** Everything the group invitation renders. */
export type GroupInvitationEmailData = GroupInvitationNotificationData;

/** Render the group invitation. */
export function groupInvitationEmail(data: GroupInvitationEmailData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  return renderGroupInvitationEmail(data, {
    appName: context.appName,
    html,
    empty: SafeHtml.EMPTY,
    renderLayout: (options) => renderLayout({ ...options, bodyHtml: options.bodyHtml as SafeHtml }, context),
    plainText: (options) => plainText(options, context),
    headers: TRANSACTIONAL_EMAIL_HEADERS,
  });
}
