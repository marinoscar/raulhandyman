import { UnprocessableEntityException } from '@nestjs/common';
import { errorCodeRegistry, registerErrorCode } from '@marinoscar/platform-api/core';

/** The domain error code of a refused retouch (HTTP 422). Registered at import time, before bootstrap. */
export const RETOUCH_NOT_ALLOWED = 'RETOUCH_NOT_ALLOWED';

if (!errorCodeRegistry.get(RETOUCH_NOT_ALLOWED)) {
  registerErrorCode({ code: RETOUCH_NOT_ALLOWED, status: 422, description: 'A "before" photo is never retouched.' });
}

export const RETOUCH_NOT_ALLOWED_MESSAGE = 'Before photos are never retouched: an altered before photo would misrepresent the work.';

export class RetouchNotAllowedException extends UnprocessableEntityException {
  constructor() {
    super({ message: RETOUCH_NOT_ALLOWED_MESSAGE, code: RETOUCH_NOT_ALLOWED });
  }
}
