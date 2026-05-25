import type { ChatMessage } from '../../../shared/gemini-types.js';
import {
  formatCodeExecutionSummaryLine,
  formatWebSearchSummaryLine,
  parseCodeExecutionBlocks,
  parseWebSearchBlocks,
  stripSpecialistBlocks,
} from './specialist-tags.js';
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
      const webSearches = parseWebSearchBlocks(message.content);
      const codeRuns = parseCodeExecutionBlocks(message.content);
      const visible = stripToolCallBlocks(stripSpecialistBlocks(message.content));

      if (preserveToolRole) {
        if (visible || message.thoughts) {
          normalized.push({
            role: 'assistant',
            content: visible || message.content,
            thoughts: message.thoughts,
            model: message.model,
          });
        }
      } else {
        if (visible) {
          normalized.push({
            role: 'assistant',
            content: visible,
            thoughts: message.thoughts,
            model: message.model,
          });
        }
        for (const search of webSearches) {
          normalized.push({
            role: 'user',
            content: formatWebSearchSummaryLine(search),
          });
        }
        for (const code of codeRuns) {
          normalized.push({
            role: 'user',
            content: formatCodeExecutionSummaryLine(code),
          });
        }
      }

      if (preserveToolRole) {
        if (webSearches.length > 0) {
          for (const search of webSearches) {
            normalized.push({
              role: 'assistant',
              content: `<web_search>\n${JSON.stringify(search)}\n</web_search>`,
              model: message.model,
            });
          }
        }
        if (codeRuns.length > 0) {
          for (const code of codeRuns) {
            normalized.push({
              role: 'assistant',
              content: `<code_execution>\n${JSON.stringify(code)}\n</code_execution>`,
              model: message.model,
            });
          }
        }
      }

      if (calls.length > 0 && preserveToolRole) {
        for (const call of calls) {
          normalized.push({
            role: 'assistant',
            content: `<tool_call name="${call.name}">\n${JSON.stringify(call.args)}\n</tool_call>`,
            model: message.model,
          });
        }
      } else if (calls.length > 0) {
        for (const call of calls) {
          normalized.push({
            role: 'user',
            content: `[Tool call ${call.name}]: ${JSON.stringify(call.args)}`,
          });
        }
      } else if (!preserveToolRole && !visible && webSearches.length === 0 && codeRuns.length === 0) {
        normalized.push({
          role: 'assistant',
          content: message.content,
          thoughts: message.thoughts,
          model: message.model,
        });
      } else if (preserveToolRole && !visible && !message.thoughts && calls.length === 0 && webSearches.length === 0 && codeRuns.length === 0) {
        normalized.push({
          role: 'assistant',
          content: message.content,
          model: message.model,
        });
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
