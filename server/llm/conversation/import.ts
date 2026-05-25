import type { ChatMessage } from '../../../shared/gemini-types.js';
import { formatToolResultLine, parseToolCallBlocks, stripToolCallBlocks } from './tool-tags.js';

export interface NormalizeImportedMessagesOptions {
  /** When false, flatten `tool` role messages to user lines (cross-provider / no native tools). */
  preserveToolRole?: boolean;
}

/**
 * Prepares imported `ChatMessage[]` for bootstrap encoding.
 * Parses `<tool_call>` blocks in assistant messages when present.
 */
export function normalizeImportedMessages(
  messages: ChatMessage[],
  options: NormalizeImportedMessagesOptions = {},
): ChatMessage[] {
  const preserveToolRole = options.preserveToolRole ?? true;
  const normalized: ChatMessage[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      normalized.push({ role: 'system', content: message.content });
      continue;
    }

    if (message.role === 'tool') {
      if (preserveToolRole && message.toolName) {
        normalized.push({
          role: 'tool',
          content: message.content,
          toolName: message.toolName,
          toolCallId: message.toolCallId,
        });
      } else {
        const name = message.toolName ?? 'unknown';
        normalized.push({
          role: 'user',
          content: formatToolResultLine(name, safeParseJson(message.content)),
        });
      }
      continue;
    }

    if (message.role === 'assistant') {
      const calls = parseToolCallBlocks(message.content);
      const visible = stripToolCallBlocks(message.content);
      if (visible) {
        normalized.push({ role: 'assistant', content: visible });
      }
      if (calls.length > 0 && preserveToolRole) {
        for (const call of calls) {
          normalized.push({
            role: 'assistant',
            content: `<tool_call name="${call.name}">\n${JSON.stringify(call.args)}\n</tool_call>`,
          });
        }
      } else if (calls.length > 0) {
        for (const call of calls) {
          normalized.push({
            role: 'user',
            content: `[Tool call ${call.name}]: ${JSON.stringify(call.args)}`,
          });
        }
      } else if (!visible) {
        normalized.push({ role: 'assistant', content: message.content });
      }
      continue;
    }

    normalized.push({ role: message.role, content: message.content });
  }

  return normalized;
}

function safeParseJson(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw: content };
  }
}
