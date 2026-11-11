import { AiError } from '@marinoscar/platform-api/ai';

/** An error whose message is safe to show a user (the job's stored error). The original is kept as `cause`. */
export class SafeJobError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SafeJobError';
  }
}

/**
 * Turns whatever a job step threw into an error with a user-safe message:
 * never provider text, a key, a URL or a prompt. A provider rate limit is
 * returned as the queue's `RateLimitError` so the job is deferred instead of
 * charged an attempt.
 */
export function toSafeAiError(error: unknown): Error {
  if (error instanceof SafeJobError) return error;
  if (error instanceof AiError) {
    const rateLimit = error.toRateLimitError();
    if (rateLimit) return rateLimit;
    switch (error.code) {
      case 'AI_STRUCTURED_OUTPUT_INVALID':
        return new SafeJobError('The AI answer could not be used. Try again.', error);
      case 'AI_CONTENT_FILTERED':
        return new SafeJobError('The AI provider declined to process this content.', error);
      case 'AI_DISABLED':
        return new SafeJobError('AI is switched off.', error);
      case 'AI_KEY_REQUIRED':
      case 'AI_KEY_INVALID':
      case 'AI_MODEL_NOT_ENABLED':
      case 'AI_MODEL_NOT_REACHABLE':
      case 'AI_PROVIDER_DISABLED':
      case 'AI_CAPABILITY_UNSUPPORTED':
        return new SafeJobError('No AI model or key is available for this. Ask an administrator to check the AI settings.', error);
      default:
        return new SafeJobError('The AI provider is not available right now. Try again later.', error);
    }
  }
  return new SafeJobError('The AI request could not be completed. Try again.', error);
}
