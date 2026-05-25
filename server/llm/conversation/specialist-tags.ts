import type { LlmExecutedTool } from '../../../shared/gemini-types.js';

export interface WebSearchTagPayload {
  queries?: string[];
  sources?: Array<{ title?: string; url?: string }>;
}

export interface CodeExecutionTagPayload {
  code?: string;
  output?: string;
  type?: string;
}

export function formatWebSearchBlock(payload: WebSearchTagPayload): string {
  return `<web_search>\n${JSON.stringify(payload)}\n</web_search>`;
}

export function formatCodeExecutionBlock(payload: CodeExecutionTagPayload): string {
  return `<code_execution>\n${JSON.stringify(payload)}\n</code_execution>`;
}

export function parseWebSearchBlocks(content: string): WebSearchTagPayload[] {
  const results: WebSearchTagPayload[] = [];
  const pattern = /<web_search>\s*([\s\S]*?)\s*<\/web_search>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    try {
      results.push(JSON.parse(match[1].trim()) as WebSearchTagPayload);
    } catch {
      results.push({ queries: [], sources: [] });
    }
  }
  return results;
}

export function parseCodeExecutionBlocks(content: string): CodeExecutionTagPayload[] {
  const results: CodeExecutionTagPayload[] = [];
  const pattern = /<code_execution>\s*([\s\S]*?)\s*<\/code_execution>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    try {
      results.push(JSON.parse(match[1].trim()) as CodeExecutionTagPayload);
    } catch {
      results.push({ output: match[1].trim() });
    }
  }
  return results;
}

export function stripSpecialistBlocks(content: string): string {
  return content
    .replace(/<web_search>[\s\S]*?<\/web_search>/g, '')
    .replace(/<code_execution>[\s\S]*?<\/code_execution>/g, '')
    .trim();
}

export function formatExecutedToolsAsTags(tools: LlmExecutedTool[] | undefined): string {
  if (!tools?.length) {
    return '';
  }

  const blocks: string[] = [];
  for (const tool of tools) {
    if (tool.searchResults?.length || tool.searchQueries?.length) {
      const sources = (tool.searchResults ?? []).map((result) => ({
        title: result.title,
        url: result.url,
      }));
      blocks.push(
        formatWebSearchBlock({
          queries: tool.searchQueries,
          sources,
        }),
      );
      continue;
    }

    const code =
      tool.arguments ??
      tool.codeResults?.map((entry) => entry.text).filter(Boolean).join('\n');
    const output = tool.output ?? tool.codeResults?.map((entry) => entry.text).join('\n');
    if (code || output || tool.type === 'python' || tool.name === 'python') {
      blocks.push(
        formatCodeExecutionBlock({
          code: typeof code === 'string' ? code : undefined,
          output: output ?? undefined,
          type: tool.type ?? tool.name ?? 'python',
        }),
      );
    }
  }

  return blocks.join('\n\n');
}

export function formatCodeExecutionSummaryLine(payload: CodeExecutionTagPayload): string {
  const output = payload.output?.trim();
  if (output) {
    return `[Code execution output]: ${output}`;
  }
  return '[Code execution]: (completed)';
}

export function formatWebSearchSummaryLine(payload: WebSearchTagPayload): string {
  const queryPart = payload.queries?.length ? ` queries: ${payload.queries.join(', ')}` : '';
  const sourceCount = payload.sources?.length ?? 0;
  return `[Web search${queryPart}; ${sourceCount} source(s)]`;
}
