// The app's shareable resource types. Making a table shareable is one
// `registerResourceType` call (roles, the minimum role per action, ownership,
// `loadOwners`), made at import time before bootstrap; sharing itself then
// needs no further code (`POST /api/grants`, the web `ShareDialog`).
//
// One ships: `document` (`documents/document.resource-type.ts`), the sample
// record of the slice. The personal `Note` is not shareable on purpose: a
// shareable record belongs to an organization (its grants are row-level-security
// rows of that organization), and a note carries none. The sharing package's
// README has the other shapes, tested (group-owned and link-shareable records,
// the public route, "resources I can see").
//
// Add yours to this array; `sharing.slice.ts` registers each when the slice is on.
// A type id is permanent once grants of it exist: list it in `resourceTypeIds` of
// `test/conformance.spec.ts`.
import type { ResourceTypeDef } from '@marinoscar/platform-api/sharing';

import { documentResourceType } from './documents/document.resource-type';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a type's role union is its own
export const APP_RESOURCE_TYPES: readonly ResourceTypeDef<any>[] = [documentResourceType];
