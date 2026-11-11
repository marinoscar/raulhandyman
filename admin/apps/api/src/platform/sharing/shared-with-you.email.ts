import {
  renderSharedWithYouEmail,
  type SharedWithYouNotificationData,
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
// "Something was shared with you" template — `sharing.shared_with_you`
// =============================================================================
//
// The words are the sharing slice's (`renderSharedWithYouEmail` in
// `@marinoscar/platform-api/sharing`); the layout, the escaping `html` tag and
// the plain-text renderer are this app's. The record's title comes from its
// resource type's `describe()` and is user-typed: every interpolation goes
// through `html`, which escapes it, and the title stays out of the subject.
// =============================================================================

/** Everything the share notification renders. */
export type SharedWithYouEmailData = SharedWithYouNotificationData;

/** Render the share notification. */
export function sharedWithYouEmail(data: SharedWithYouEmailData, ctx?: EmailRenderContext): RenderedEmail {
  const context = resolveEmailRenderContext(ctx);
  return renderSharedWithYouEmail(data, {
    appName: context.appName,
    html,
    empty: SafeHtml.EMPTY,
    renderLayout: (options) => renderLayout({ ...options, bodyHtml: options.bodyHtml as SafeHtml }, context),
    plainText: (options) => plainText(options, context),
    headers: TRANSACTIONAL_EMAIL_HEADERS,
  });
}
