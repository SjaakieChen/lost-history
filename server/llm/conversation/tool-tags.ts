/** Canonical portable format for tool calls in assistant message text. */

const TOOL_CALL_OPEN = /<tool_call name="([^"]+)">\s*/;
const TOOL_CALL_CLOSE = /\s*<\/tool_call>/g;

export function formatToolCallBlock(name: string, args: Record<string, unknown>): string {
  return `<tool_call name="${name}">\n${JSON.stringify(args)}\n</tool_call>`;
}

export function formatAssistantToolStep(
  visibleText: string | undefined,
  calls: Array<{ name: string; args?: Record<string, unknown> }>,
): string {
  const blocks = calls.map((call) => formatToolCallBlock(call.name, call.args ?? {}));
  const toolSection = blocks.join('\n');
  if (visibleText?.trim()) {
    return `${visibleText.trim()}\n\n${toolSection}`;
  }
  return toolSection;
}

export function parseToolCallBlocks(content: string): Array<{ name: string; args: Record<string, unknown> }> {
  const results: Array<{ name: string; args: Record<string, unknown> }> = [];
  const pattern = /<tool_call name="([^"]+)">\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const name = match[1];
    const body = match[2].trim();
    let args: Record<string, unknown> = {};
    if (body) {
      try {
        args = JSON.parse(body) as Record<string, unknown>;
      } catch {
        args = { raw: body };
      }
    }
    results.push({ name, args });
  }
  return results;
}

export function stripToolCallBlocks(content: string): string {
  return content.replace(/<tool_call name="[^"]+">[\s\S]*?<\/tool_call>/g, '').trim();
}

export function formatToolResultLine(toolName: string, response: Record<string, unknown>): string {
  return `[Tool result ${toolName}]: ${JSON.stringify(response)}`;
}

export { TOOL_CALL_OPEN, TOOL_CALL_CLOSE };
