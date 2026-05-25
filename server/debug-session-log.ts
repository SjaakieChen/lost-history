import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const DEBUG_LOG = join(process.cwd(), 'debug-b534ab.log');
const SESSION_ID = 'b534ab';

/** Append one NDJSON line for this debug session (server-side; survives without ingest fetch). */
export function debugSessionLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  try {
    const line =
      JSON.stringify({
        sessionId: SESSION_ID,
        location,
        message,
        data,
        hypothesisId,
        timestamp: Date.now(),
      }) + '\n';
    appendFileSync(DEBUG_LOG, line, 'utf8');
  } catch {
    // ignore logging failures
  }
}
