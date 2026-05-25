import type { ChatMessage } from '../../../shared/gemini-types.js';
import type { ResolvedTextModel } from '../../gemini/models.js';
import { createThreadState } from './bootstrap.js';

/** Re-bootstrap provider thread from portable messages after failover or provider switch. */
export function rebuildThreadForProvider(
  messages: ChatMessage[],
  systemInstruction: string | undefined,
  resolved: ResolvedTextModel,
): ReturnType<typeof createThreadState> {
  return createThreadState(resolved, {
    messages,
    systemInstruction,
  });
}
