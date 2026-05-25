import type OpenAI from 'openai';
import type { LlmExecutedTool, LlmSearchResult } from '../../shared/gemini-types.js';

/** Groq extends OpenAI chat message with reasoning and executed built-in tools. */
export type GroqChatCompletionMessage = OpenAI.Chat.Completions.ChatCompletionMessage & {
  reasoning?: string | null;
  executed_tools?: GroqExecutedToolRaw[] | null;
};

export type GroqExecutedToolRaw = {
  name?: string;
  type?: string;
  arguments?: string;
  output?: string;
  search_results?: {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
    }>;
  } | null;
  code_results?: Array<{ text?: string }> | null;
};

export function asGroqMessage(
  message: OpenAI.Chat.Completions.ChatCompletionMessage | undefined,
): GroqChatCompletionMessage | undefined {
  return message as GroqChatCompletionMessage | undefined;
}

function parseSearchResults(raw: GroqExecutedToolRaw): LlmSearchResult[] | undefined {
  const results = raw.search_results?.results;
  if (!results?.length) {
    return undefined;
  }
  return results.map((entry) => ({
    title: entry.title,
    url: entry.url,
    content: entry.content,
    score: entry.score,
  }));
}

function parseCodeFromArguments(args: string | undefined): string | undefined {
  if (!args?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(args) as { code?: string };
    if (typeof parsed.code === 'string') {
      return parsed.code;
    }
  } catch {
    return args;
  }
  return args;
}

export function parseGroqExecutedTools(
  raw: GroqExecutedToolRaw[] | null | undefined,
): LlmExecutedTool[] | undefined {
  if (!raw?.length) {
    return undefined;
  }

  const mapped: LlmExecutedTool[] = [];
  for (const entry of raw) {
    const searchResults = parseSearchResults(entry);
    const codeResults = entry.code_results ?? undefined;
    const tool: LlmExecutedTool = {
      name: entry.name,
      type: entry.type,
      arguments: entry.arguments,
      output: entry.output,
      searchResults,
      codeResults,
    };

    if (
      tool.searchResults?.length ||
      tool.output ||
      tool.codeResults?.length ||
      tool.arguments
    ) {
      mapped.push(tool);
    }
  }

  return mapped.length > 0 ? mapped : undefined;
}

export function isCompoundRegistryKey(registryKey: string): boolean {
  return registryKey.startsWith('groq--compound');
}

export function isGptOssApiModel(apiModelId: string): boolean {
  return /gpt-oss/i.test(apiModelId);
}

/** GPT-OSS rejects `executed_tools` on assistant messages in follow-up requests; strip before send. */
export function sanitizeGroqMessagesForApi(
  messages: import('openai/resources/chat/completions.js').ChatCompletionMessageParam[],
  apiModelId: string,
): import('openai/resources/chat/completions.js').ChatCompletionMessageParam[] {
  if (!isGptOssApiModel(apiModelId)) {
    return messages;
  }
  return messages.map((message) => {
    if (message.role !== 'assistant') {
      return message;
    }
    const withTools = message as GroqChatCompletionMessage;
    if (withTools.executed_tools === undefined) {
      return message;
    }
    const { executed_tools: _removed, ...rest } = withTools;
    return rest as import('openai/resources/chat/completions.js').ChatCompletionMessageParam;
  });
}
