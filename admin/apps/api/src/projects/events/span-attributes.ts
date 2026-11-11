import { trace } from '@opentelemetry/api';

/** The span attributes this feature may set. Ids and a rendition name only: never notes, copy, URLs or keys. */
export interface ProjectSpanAttributes {
  orgId?: string;
  projectId?: string;
  photoId?: string;
  rendition?: string;
}

/**
 * Sets `org.id`, `project.id`, `photo.id` and `rendition` on the active span
 * (the one `@Trace()` opened). A no-op without an active span. Never throws.
 */
export function setSpanAttributes(attributes: ProjectSpanAttributes): void {
  try {
    const span = trace.getActiveSpan();
    if (!span) return;
    if (attributes.orgId) span.setAttribute('org.id', attributes.orgId);
    if (attributes.projectId) span.setAttribute('project.id', attributes.projectId);
    if (attributes.photoId) span.setAttribute('photo.id', attributes.photoId);
    if (attributes.rendition) span.setAttribute('rendition', attributes.rendition);
  } catch {
    // tracing must never affect the work
  }
}
