import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CallLlmOptions,
  CallLlmResult,
  ChatMessage,
  ExportMessagesOptions,
  LlmCallCapabilities,
  LlmProvider,
  LlmSessionOptions,
} from '../../shared/gemini-types.js';
import type {
  LiveFixtureCallContext,
  LlmSession,
  SessionTurnRecord,
} from '../../server/llm/session.js';

const HELPERS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HELPERS_DIR, '../..');
const FIXTURES_ROOT = path.join(REPO_ROOT, 'calibration', 'live-fixtures');

export interface LiveFixtureMeta {
  scenarioId: string;
  codebaseVersion: string;
  recordedAt: string;
  provider: LlmProvider;
  capabilities?: LlmCallCapabilities;
  model?: string;
  gitCommit?: string;
}

export interface LiveFixtureSessionAfter {
  lockedRegistryKey?: string;
  history: SessionTurnRecord[];
  exportMessages: ChatMessage[];
}

export interface LiveFixtureStep {
  turn: number;
  contextSent: LiveFixtureCallContext;
  result: CallLlmResult;
  transcriptTurn: ChatMessage[];
  sessionAfter?: LiveFixtureSessionAfter;
  raw?: Record<string, unknown>;
}

export interface LiveFixtureSessionConfig {
  options: LlmSessionOptions;
  exportOptions: ExportMessagesOptions;
}

export interface LiveFixtureRun {
  meta: LiveFixtureMeta;
  session: LiveFixtureSessionConfig | null;
  steps: LiveFixtureStep[];
  final: LiveFixtureSessionAfter | null;
}

interface ManifestEntry {
  scenarioId: string;
  provider: LlmProvider;
  turnCount: number;
  exportMessageCount: number;
  threadOnTurn2Plus: boolean;
  file: string;
}

interface Manifest {
  codebaseVersion: string;
  recordedAt: string;
  gitCommit?: string;
  scenarios: ManifestEntry[];
}

const manifestEntries: ManifestEntry[] = [];
let runRecordedAt: string | undefined;
let runGitCommit: string | undefined;

/** Call once before a record pass (e.g. live test `beforeAll`). */
export function resetFixtureRecordingState(): void {
  manifestEntries.length = 0;
  runRecordedAt = undefined;
  runGitCommit = undefined;
}

export function isRecordingFixtures(): boolean {
  return (
    process.env.RECORD_LIVE_FIXTURES === '1' ||
    process.env.npm_lifecycle_event === 'test:llm:live:record'
  );
}

export function getCodebaseVersion(): string {
  const packagePath = path.join(REPO_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version: string };
  return pkg.version;
}

export function getFixtureDir(version = getCodebaseVersion()): string {
  return path.join(FIXTURES_ROOT, version);
}

function tryGitCommit(): string | undefined {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

function stripInternalResult(result: CallLlmResult): CallLlmResult {
  const { threadState: _t, providerRequest: _p, ...publicResult } = result as CallLlmResult & {
    threadState?: unknown;
    providerRequest?: unknown;
  };
  return publicResult;
}

export function snapshotSessionAfter(
  session: LlmSession,
  exportOptions: ExportMessagesOptions = { includeToolSummary: true },
): LiveFixtureSessionAfter {
  return {
    lockedRegistryKey: session.getLockedRegistryKey(),
    history: session.getModelHistory(),
    exportMessages: session.exportMessages(exportOptions),
  };
}

export function buildCallContextFromOptions(
  options: Pick<CallLlmOptions, 'prompt' | 'messages'>,
): LiveFixtureCallContext {
  return {
    prompt: options.prompt,
    messages: options.messages,
    hasThreadState: false,
  };
}

export function recordFixtureRun(run: LiveFixtureRun): void {
  if (!isRecordingFixtures()) {
    return;
  }

  const version = run.meta.codebaseVersion;
  const scenariosDir = path.join(getFixtureDir(version), 'scenarios');
  fs.mkdirSync(scenariosDir, { recursive: true });

  const fileName = `${run.meta.scenarioId}.json`;
  const filePath = path.join(scenariosDir, fileName);
  fs.writeFileSync(filePath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');

  const lastStep = run.steps[run.steps.length - 1];
  const exportCount =
    run.final?.exportMessages.length ??
    lastStep?.sessionAfter?.exportMessages.length ??
    lastStep?.transcriptTurn.length ??
    0;
  const threadOnTurn2Plus = run.steps.some(
    (step) => step.turn >= 2 && step.contextSent.hasThreadState,
  );

  manifestEntries.push({
    scenarioId: run.meta.scenarioId,
    provider: run.meta.provider,
    turnCount: run.steps.length,
    exportMessageCount: exportCount,
    threadOnTurn2Plus,
    file: `scenarios/${fileName}`,
  });

  if (!runRecordedAt) {
    runRecordedAt = run.meta.recordedAt;
  }
  if (!runGitCommit && run.meta.gitCommit) {
    runGitCommit = run.meta.gitCommit;
  }
}

export function recordSingleCallFixture(params: {
  scenarioId: string;
  provider: LlmProvider;
  callOptions: Pick<CallLlmOptions, 'prompt' | 'messages' | 'model' | 'capabilities'>;
  result: CallLlmResult;
  raw?: Record<string, unknown>;
}): void {
  if (!isRecordingFixtures()) {
    return;
  }

  const recordedAt = new Date().toISOString();
  recordFixtureRun({
    meta: {
      scenarioId: params.scenarioId,
      codebaseVersion: getCodebaseVersion(),
      recordedAt,
      provider: params.provider,
      capabilities: params.callOptions.capabilities,
      model: params.callOptions.model,
      gitCommit: tryGitCommit(),
    },
    session: null,
    steps: [
      {
        turn: 1,
        contextSent: buildCallContextFromOptions(params.callOptions),
        result: stripInternalResult(params.result),
        transcriptTurn: params.result.messages ?? [],
        raw: params.raw,
      },
    ],
    final: null,
  });
}

const DEFAULT_EXPORT_OPTIONS: ExportMessagesOptions = { includeToolSummary: true };

export class SessionFixtureRecorder {
  private readonly steps: LiveFixtureStep[] = [];
  private readonly exportOptions: ExportMessagesOptions;
  private readonly recordedAt: string;
  private readonly gitCommit?: string;

  constructor(
    private readonly scenarioId: string,
    private readonly session: LlmSession,
    private readonly provider: LlmProvider,
    exportOptions: ExportMessagesOptions = DEFAULT_EXPORT_OPTIONS,
  ) {
    this.exportOptions = exportOptions;
    this.recordedAt = new Date().toISOString();
    this.gitCommit = tryGitCommit();
  }

  addStep(result: CallLlmResult, raw?: Record<string, unknown>): void {
    if (!isRecordingFixtures()) {
      return;
    }

    const contextSent = this.session.getLastCallContext();
    if (!contextSent) {
      throw new Error(`SessionFixtureRecorder: no call context for scenario ${this.scenarioId}`);
    }

    this.steps.push({
      turn: this.steps.length + 1,
      contextSent: { ...contextSent },
      result: stripInternalResult(result),
      transcriptTurn: result.messages ?? [],
      sessionAfter: snapshotSessionAfter(this.session, this.exportOptions),
      raw,
    });
  }

  finish(): void {
    if (!isRecordingFixtures() || this.steps.length === 0) {
      return;
    }

    const lastAfter = this.steps[this.steps.length - 1].sessionAfter;
    const options = this.session.getSessionOptions();

    recordFixtureRun({
      meta: {
        scenarioId: this.scenarioId,
        codebaseVersion: getCodebaseVersion(),
        recordedAt: this.recordedAt,
        provider: this.provider,
        capabilities: options.capabilities,
        model: options.model,
        gitCommit: this.gitCommit,
      },
      session: {
        options,
        exportOptions: this.exportOptions,
      },
      steps: this.steps,
      final: lastAfter
        ? {
            lockedRegistryKey: lastAfter.lockedRegistryKey,
            history: [...lastAfter.history],
            exportMessages: [...lastAfter.exportMessages],
          }
        : null,
    });
  }
}

export function finalizeFixtureRun(): void {
  if (!isRecordingFixtures() || manifestEntries.length === 0) {
    return;
  }

  const version = getCodebaseVersion();
  const dir = getFixtureDir(version);
  fs.mkdirSync(dir, { recursive: true });

  const manifest: Manifest = {
    codebaseVersion: version,
    recordedAt: runRecordedAt ?? new Date().toISOString(),
    gitCommit: runGitCommit ?? tryGitCommit(),
    scenarios: [...manifestEntries],
  };

  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const lines = [
    '# Live fixture index',
    '',
    `Generated: ${manifest.recordedAt}`,
    `Codebase version: ${version}`,
    manifest.gitCommit ? `Git commit: \`${manifest.gitCommit.slice(0, 12)}\`` : '',
    '',
    '| scenarioId | provider | turns | exportMessages | thread turn 2+ | file |',
    '|------------|----------|-------|----------------|----------------|------|',
  ];

  for (const entry of manifest.scenarios) {
    lines.push(
      `| ${entry.scenarioId} | ${entry.provider} | ${entry.turnCount} | ${entry.exportMessageCount} | ${entry.threadOnTurn2Plus ? 'yes' : 'no'} | ${entry.file} |`,
    );
  }

  lines.push('');
  fs.writeFileSync(path.join(dir, 'index.md'), lines.join('\n'), 'utf8');
}

export function getFixtureManifestPath(version = getCodebaseVersion()): string {
  return path.join(getFixtureDir(version), 'manifest.json');
}
