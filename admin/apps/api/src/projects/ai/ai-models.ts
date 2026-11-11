import type { ModuleRef } from '@nestjs/core';
import { UsableModelsService } from '@marinoscar/platform-api/ai';

import { SafeJobError } from './ai-errors';

export interface PickedModel {
  provider: string;
  modelId: string;
}

/**
 * The model a job calls: the first model the caller can use right now (enabled by
 * an administrator in Admin, AI, Models, on an enabled provider, with a key that
 * reaches it) whose capabilities satisfy `accepts`, a `gpt-` family model first.
 * Models the administrator left off are never listed, so the admin's choice
 * stands. `UsableModelsService` lives in an AI sub-module the slice does not
 * re-export, so it is resolved across modules.
 */
export async function pickUsableModel(
  moduleRef: ModuleRef,
  userId: string,
  orgId: string,
  accepts: (capabilities: { capabilities: readonly string[]; inputModalities: readonly string[] }) => boolean,
  missing: string,
): Promise<PickedModel> {
  const usable = await moduleRef.get(UsableModelsService, { strict: false }).listForUser(userId, { orgId });
  const candidates = usable.filter((model) => accepts(model.capabilities));
  const chosen = candidates.find((model) => model.modelId.startsWith('gpt-')) ?? candidates[0];
  if (!chosen) throw new SafeJobError(missing);
  return { provider: chosen.provider, modelId: chosen.modelId };
}
