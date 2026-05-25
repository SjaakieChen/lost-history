import type {
  AgentStep,
  ChatMessage,
  ExportMessagesOptions,
} from '../../../shared/gemini-types.js';
import { formatAgentStepAssistantContent } from './transcript.js';
import { stripToolCallBlocks } from './tool-tags.js';
import { stripSpecialistBlocks } from './specialist-tags.js';

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
    if (
      !includeToolSummary &&
      message.role === 'assistant' &&
      (message.content.includes('<tool_call') ||
        message.content.includes('<web_search') ||
        message.content.includes('<code_execution'))
    ) {
      const visible = stripToolCallBlocks(stripSpecialistBlocks(message.content));
      if (visible || message.thoughts) {
        out.push({
          role: 'assistant',
          content: visible || message.content,
          thoughts: message.thoughts,
          model: message.model,
        });
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
          content: formatAgentStepAssistantContent(
            visibleText,
            step.functionCalls,
            step.executedTools,
          ),
          thoughts: step.thoughts,
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

    if (visibleText || step.executedTools?.length) {
      out.push({
        role: 'assistant',
        content: formatAgentStepAssistantContent(visibleText, undefined, step.executedTools),
        thoughts: step.thoughts,
        model: stepModel,
      });
    } else if (step.thoughts) {
      out.push({
        role: 'assistant',
        content: '',
        thoughts: step.thoughts,
        model: stepModel,
      });
    }
  }

  return out;
}
