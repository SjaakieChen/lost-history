import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTranscriptTurnFromResult } from '../../server/llm/conversation/transcript.js';
import {
  getCodebaseVersion,
  getFixtureDir,
  getFixtureManifestPath,
  type LiveFixtureRun,
  type LiveFixtureStep,
} from '../helpers/live-fixture-record.js';

function loadFixtureRuns(): LiveFixtureRun[] {
  const manifestPath = getFixtureManifestPath();
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    scenarios: Array<{ file: string }>;
  };
  const dir = getFixtureDir();

  return manifest.scenarios.map((entry) => {
    const filePath = pathJoinFixture(dir, entry.file);
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as LiveFixtureRun;
  });
}

function pathJoinFixture(dir: string, relative: string): string {
  return `${dir}/${relative.replace(/\\/g, '/')}`;
}

function lastUserPrompt(step: LiveFixtureStep): string {
  const fromContext = step.contextSent.prompt;
  if (fromContext?.trim()) {
    return fromContext.trim();
  }
  const userInTurn = step.transcriptTurn.find((message) => message.role === 'user');
  return userInTurn?.content?.trim() ?? '';
}

function assertTranscriptTurnMatchesExport(step: LiveFixtureStep): void {
  if (!step.sessionAfter?.exportMessages.length) {
    return;
  }

  const userPrompt = lastUserPrompt(step);
  if (!userPrompt) {
    return;
  }

  const rebuilt = buildTranscriptTurnFromResult({
    userPrompt,
    result: step.result,
    includeToolCalls: true,
  });

  const exportMessages = step.sessionAfter.exportMessages;
  const tail = exportMessages.slice(-rebuilt.length);

  expect(tail).toHaveLength(rebuilt.length);
  for (let index = 0; index < rebuilt.length; index += 1) {
    expect(tail[index].role).toBe(rebuilt[index].role);
    expect(tail[index].content).toBe(rebuilt[index].content);
    if (rebuilt[index].thoughts) {
      expect(tail[index].thoughts).toBe(rebuilt[index].thoughts);
    }
    if (rebuilt[index].model) {
      expect(tail[index].model).toBe(rebuilt[index].model);
    }
  }
}

const runs = loadFixtureRuns();
const strict = process.env.LIVE_FIXTURE_STRICT === '1';

describe('live fixture contract', () => {
  if (runs.length === 0) {
    it.skipIf(!strict)('skips when no local fixtures (run npm run test:llm:live:record)', () => {
      if (strict) {
        expect(
          fs.existsSync(getFixtureManifestPath()),
          `Missing fixtures at ${getFixtureDir()}; run test:llm:live:record`,
        ).toBe(true);
      }
    });
    return;
  }

  it('fixture version matches package.json', () => {
    const version = getCodebaseVersion();
    for (const run of runs) {
      expect(run.meta.codebaseVersion).toBe(version);
    }
  });

  for (const run of runs) {
    describe(run.meta.scenarioId, () => {
      it('has required sections and steps', () => {
        expect(run.meta.scenarioId).toBeTruthy();
        expect(run.steps.length).toBeGreaterThan(0);
        if (run.session) {
          expect(run.final).toBeTruthy();
        }
      });

      if (run.session) {
        it('session final matches last step sessionAfter', () => {
          const last = run.steps[run.steps.length - 1].sessionAfter;
          expect(run.final?.exportMessages).toEqual(last?.exportMessages);
          expect(run.final?.history).toEqual(last?.history);
        });
      }

      for (const step of run.steps) {
        it(`turn ${step.turn}: context and transcript shape`, () => {
          expect(step.contextSent).toBeDefined();
          expect(typeof step.contextSent.hasThreadState).toBe('boolean');
          expect(step.result.registryKey).toBeTruthy();
          expect(step.transcriptTurn.length).toBeGreaterThan(0);

          if (step.turn >= 2 && run.session && run.steps.length >= 2) {
            expect(step.contextSent.hasThreadState).toBe(true);
          }

          if (step.sessionAfter) {
            const expectedTurns = step.turn * 2;
            expect(step.sessionAfter.history.length).toBe(expectedTurns);
            assertTranscriptTurnMatchesExport(step);
          }
        });
      }
    });
  }
});
