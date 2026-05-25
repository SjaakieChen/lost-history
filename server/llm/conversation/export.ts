import type {
  AgentStep,
  ChatMessage,
  ExportMessagesOptions,
} from '../../../shared/gemini-types.js';
import { formatAssistantToolStep } from './tool-tags.js';

/**
 * Builds a portable `ChatMessage[]` transcript from base messages and agent steps.
 */
export function exportToMessages(
  baseMessages: ChatMessage[],
  steps: AgentStep[],
  options: ExportMessagesOptions = {},
): ChatMessage[] {
  const includeToolSummary = options.includeToolSummary ?? true;
  const out: ChatMessage[] = [];

  for (const message of baseMessages) {
    if (message.role === 'system') {
      continue;
    }
    if (!includeToolSummary && message.role === 'tool') {
      continue;
    }
    if (!includeToolSummary && message.role === 'assistant' && message.content.includes('<tool_call')) {
      const visible = message.content.replace(/<tool_call[\s\S]*?<\/tool_call>/g, '').trim();
      if (visible) {
        out.push({ role: 'assistant', content: visible });
      }
      continue;
    }
    out.push({ ...message });
  }

  for (const step of steps) {
    const visibleText =
      step.text && step.text !== 'No response text received.' ? step.text : undefined;

    const stepModel = step.model;

    if (step.functionCalls?.length) {
      if (includeToolSummary) {
        out.push({
          role: 'assistant',
          content: formatAssistantToolStep(visibleText, step.functionCalls),
          model: stepModel,
        });
        for (const tool of step.toolResults ?? []) {
          out.push({
            role: 'tool',
            toolName: tool.name,
            content: JSON.stringify(tool.response),
            model: stepModel,
          });
        }
      } else if (visibleText) {
        out.push({ role: 'assistant', content: visibleText, model: stepModel });
      }
      continue;
    }

    if (visibleText) {
      out.push({ role: 'assistant', content: visibleText, model: stepModel });
    }
  }

  return out;
}
