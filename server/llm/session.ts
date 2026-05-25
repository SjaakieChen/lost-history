import type {
  CallLlmAgentOptions,
  CallLlmAgentResult,
  CallLlmResult,
  ChatMessage,
  ExportMessagesOptions,
  LlmSessionOptions,
} from '../../shared/gemini-types.js';
import { createExhaustionContext } from '../gemini/availability.js';
import { callLlmAgent } from '../gemini/call-llm-agent.js';
import { callLlm, type InternalCallLlmOptions, type InternalCallLlmResult } from '../gemini/call-llm.js';
import { exportToMessages } from './conversation/export.js';

export interface SessionTurnRecord {
  role: ChatMessage['role'];
  content: string;
  model?: string;
  toolName?: string;
}

export class LlmSession {
  private thread: import('./conversation/types.js').ProviderThreadState | undefined;
  private lockedRegistryKey: string | undefined;
  private readonly turns: SessionTurnRecord[] = [];
  private agentSteps: import('../../shared/gemini-types.js').AgentStep[] = [];
  private readonly exhaustionContext = createExhaustionContext();

  constructor(private readonly options: LlmSessionOptions) {
    if (options.messages?.length) {
      for (const message of options.messages) {
        if (message.role !== 'system') {
          this.turns.push({
            role: message.role,
            content: message.content,
            toolName: message.toolName,
          });
        }
      }
    }
    if (options.prompt?.trim()) {
      this.turns.push({ role: 'user', content: options.prompt.trim() });
    }
  }

  private baseMessages(): ChatMessage[] {
    return this.turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
      ...(turn.toolName ? { toolName: turn.toolName } : {}),
      ...(turn.model ? { model: turn.model } : {}),
    }));
  }

  async send(sendOptions?: { prompt?: string }): Promise<CallLlmResult> {
    const prompt = sendOptions?.prompt?.trim();
    if (prompt) {
      this.turns.push({ role: 'user', content: prompt });
    }

    const threadRebuildMessages = this.turns.length > 1 ? this.baseMessages() : undefined;

    const callOptions: InternalCallLlmOptions = {
      ...this.options,
      model: this.lockedRegistryKey ?? this.options.model,
      prompt: this.thread ? undefined : prompt ?? this.options.prompt,
      messages: this.thread ? undefined : this.baseMessages(),
      threadState: this.thread,
      threadRebuildMessages,
      exhaustionContext: this.exhaustionContext,
    };

    const result: InternalCallLlmResult = await callLlm(callOptions);
    if (result.threadState) {
      this.thread = result.threadState;
    }
    this.lockedRegistryKey = result.registryKey;

    this.turns.push({
      role: 'assistant',
      content: result.text,
      model: result.registryKey,
    });

    const { threadState: _threadState, ...publicResult } = result;
    return publicResult;
  }

  async runAgent(agentOptions: CallLlmAgentOptions): Promise<CallLlmAgentResult> {
    const merged: CallLlmAgentOptions = {
      ...this.options,
      ...agentOptions,
      model: this.lockedRegistryKey ?? agentOptions.model ?? this.options.model,
      messages: this.turns.length ? this.baseMessages() : agentOptions.messages,
      prompt: undefined,
    };
    const result = await callLlmAgent(merged);
    this.lockedRegistryKey = result.registryKey;
    this.agentSteps = result.steps;

    if (result.messages?.length) {
      this.turns.length = 0;
      for (const message of result.messages) {
        this.turns.push({
          role: message.role,
          content: message.content,
          model: message.model,
          toolName: message.toolName,
        });
      }
    }

    return result;
  }

  exportMessages(exportOptions?: ExportMessagesOptions): ChatMessage[] {
    if (this.agentSteps.length > 0) {
      return exportToMessages(this.baseMessages(), this.agentSteps, exportOptions);
    }
    return this.baseMessages();
  }

  getModelHistory(): SessionTurnRecord[] {
    return [...this.turns];
  }
}
