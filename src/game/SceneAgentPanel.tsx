import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type {
  AgentStep,
  ChatMessage,
  LlmAgentDebug,
  TextModelInfo,
} from '../../shared/gemini-types.js';
import type { LandscapeSceneState } from '../../shared/scene-agent-types.js';
import ModelContextViewer from './ModelContextViewer.js';

export interface SceneAgentResponse {
  text: string;
  sceneState: LandscapeSceneState;
  steps: AgentStep[];
  stepCount: number;
  terminationReason: string;
  registryKey: string;
  model: string;
  messages?: ChatMessage[];
  debug?: LlmAgentDebug;
  usage?: LlmAgentDebug['usage'];
  thoughts?: string;
  modelsAttempted?: string[];
  modelSelectedBy?: string;
  error?: string;
  capability?: string;
  failureKind?: string;
  blockedModels?: string[];
}

interface SceneAgentErrorBody {
  error?: string;
  model?: string;
  capability?: string;
  failureKind?: string;
  blockedModels?: string[];
  registryKey?: string;
  retryAfterSec?: number;
}

function formatSceneAgentError(status: number, body: SceneAgentErrorBody): string {
  const lines: string[] = [body.error ?? `Scene agent failed (${status})`];
  if (body.capability) lines.push(`Missing capability: ${body.capability}`);
  if (body.model) lines.push(`Model: ${body.model}`);
  if (body.registryKey && body.registryKey !== body.model) {
    lines.push(`Registry: ${body.registryKey}`);
  }
  if (body.failureKind) lines.push(`Failure: ${body.failureKind}`);
  if (body.blockedModels?.length) {
    lines.push(`Blocked / exhausted: ${body.blockedModels.join(', ')}`);
  }
  if (body.retryAfterSec) lines.push(`Retry after ~${body.retryAfterSec}s`);
  return lines.join('\n');
}

function stepHasToolCalls(steps: AgentStep[]): boolean {
  return steps.some((s) => (s.functionCalls?.length ?? 0) > 0);
}

interface SceneAgentPanelProps {
  sceneState: LandscapeSceneState;
  onSceneStateChange: (state: LandscapeSceneState) => void;
  onAgentComplete?: (response: SceneAgentResponse) => void;
}

export default function SceneAgentPanel({
  sceneState,
  onSceneStateChange,
  onAgentComplete,
}: SceneAgentPanelProps) {
  const [allModels, setAllModels] = useState<TextModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [responseText, setResponseText] = useState('');
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [routingNote, setRoutingNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [showToolLog, setShowToolLog] = useState(true);
  const [modelDebug, setModelDebug] = useState<LlmAgentDebug | null>(null);
  const [showModelContext, setShowModelContext] = useState(true);

  const sceneModels = allModels.filter((m) => m.supportsFunctionCalling);
  const nonSceneModels = allModels.filter((m) => !m.supportsFunctionCalling);

  useEffect(() => {
    void fetch('/api/models')
      .then(async (res) => {
        const data = (await res.json()) as { models?: TextModelInfo[]; error?: string };
        if (!res.ok) {
          throw new Error(data.error ?? `Models request failed (${res.status})`);
        }
        if (!Array.isArray(data.models)) {
          throw new Error('Models response missing models array.');
        }
        return data.models;
      })
      .then((models) => {
        setAllModels(models);
        const fc = models.filter((m) => m.supportsFunctionCalling);
        if (fc.length > 0 && !selectedModel) {
          setSelectedModel(fc[0].id);
        }
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Failed to load models (is the API server running?)';
        setError(message);
      });
  }, []);

  const runAgent = useCallback(
    async (userPrompt: string, history: ChatMessage[]) => {
      setLoading(true);
      setError('');
      setWarning('');
      setRoutingNote('');
      setResponseText('');
      setSteps([]);
      setModelDebug(null);

      const outboundMessages: ChatMessage[] = [...history];
      if (userPrompt.trim()) {
        outboundMessages.push({ role: 'user', content: userPrompt.trim() });
      }

      try {
        const res = await fetch('/api/scene-agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel || undefined,
            messages: outboundMessages.length > 0 ? outboundMessages : undefined,
            prompt: undefined,
            sceneState,
            maxSteps: 12,
            debug: true,
          }),
        });

        const data = (await res.json()) as SceneAgentResponse & SceneAgentErrorBody;

        if (!res.ok) {
          throw new Error(formatSceneAgentError(res.status, data));
        }

        onSceneStateChange(data.sceneState);
        setResponseText(data.text);
        setSteps(data.steps ?? []);
        setModelDebug(data.debug ?? null);
        onAgentComplete?.(data);

        if (data.registryKey && data.registryKey !== selectedModel) {
          const attempted = data.modelsAttempted?.length
            ? ` (tried: ${data.modelsAttempted.join(' → ')})`
            : '';
          setRoutingNote(
            `Requested ${selectedModel} → used ${data.registryKey} via ${data.modelSelectedBy ?? 'routing'}${attempted}`,
          );
        }

        if (data.terminationReason === 'natural' && !stepHasToolCalls(data.steps ?? [])) {
          setWarning(
            'Model finished without calling scene tools — it may be too weak for tool use, or it replied in plain text only.',
          );
        }

        if (data.messages?.length) {
          setMessages(data.messages);
        } else {
          const nextMessages: ChatMessage[] = [...outboundMessages];
          nextMessages.push({ role: 'assistant', content: data.text });
          setMessages(nextMessages);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [onAgentComplete, onSceneStateChange, sceneState, selectedModel],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;
    await runAgent(trimmed, messages);
    setPrompt('');
  }

  function handleClearChat() {
    setMessages([]);
    setResponseText('');
    setSteps([]);
    setError('');
    setWarning('');
    setRoutingNote('');
    setModelDebug(null);
  }

  return (
    <div className="scene-agent">
      <div className="scene-agent__controls">
        <label htmlFor="scene-model">Model</label>
        <select
          id="scene-model"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={loading || sceneModels.length === 0}
        >
          <optgroup label="Scene tools (function calling)">
            {sceneModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.id})
              </option>
            ))}
          </optgroup>
          {nonSceneModels.length > 0 && (
            <optgroup label="Not for scene agent (no local tools)">
              {nonSceneModels.map((m) => (
                <option key={m.id} value={m.id} disabled>
                  {m.displayName} — {m.supportsWebSearch ? 'Groq built-in web/code' : 'no function calling'}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="scene-agent__hint">
          Groq Compound lives here as <code>groq--compound-off</code> /{' '}
          <code>groq--compound-mini-off</code> (disabled): they use Groq&apos;s built-in web/code
          tools, not our scene catalog tools.
        </p>
      </div>

      <form className="scene-agent__form" onSubmit={handleSubmit}>
        <label htmlFor="scene-prompt">Instruction</label>
        <textarea
          id="scene-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Place a red candle at depth 15m and move the viewer slightly left."
          rows={4}
          required
        />
        <div className="scene-agent__actions">
          <button type="submit" disabled={loading || !prompt.trim() || !selectedModel}>
            {loading ? 'Running agent…' : 'Run scene agent'}
          </button>
          <button type="button" className="secondary" onClick={handleClearChat} disabled={loading}>
            Clear chat
          </button>
        </div>
      </form>

      {messages.length > 0 && (
        <p className="scene-agent__meta">
          {messages.length} portable message(s) in thread — full model view below after each run
        </p>
      )}

      {routingNote && <p className="scene-agent__routing">{routingNote}</p>}
      {warning && <p className="scene-agent__warning">{warning}</p>}
      {error && <pre className="error scene-agent__error">{error}</pre>}

      {responseText && (
        <div className="response">
          <h3>Agent reply</h3>
          <p>{responseText}</p>
        </div>
      )}

      {modelDebug && (
        <div className="scene-agent__model-context">
          <button
            type="button"
            className="scene-agent__tools-toggle"
            onClick={() => setShowModelContext((v) => !v)}
          >
            {showModelContext ? 'Hide' : 'Show'} model context (what the LLM saw)
          </button>
          {showModelContext && <ModelContextViewer debug={modelDebug} />}
        </div>
      )}

      {steps.length > 0 && (
        <div className="scene-agent__tools">
          <button
            type="button"
            className="scene-agent__tools-toggle"
            onClick={() => setShowToolLog((v) => !v)}
          >
            {showToolLog ? 'Hide' : 'Show'} tool log ({steps.length} steps)
          </button>
          {showToolLog && (
            <ol className="scene-agent__steps">
              {steps.map((step) => (
                <li key={step.step}>
                  <strong>Step {step.step}</strong>{' '}
                  <span className="scene-agent__step-model">{step.model}</span>
                  {step.functionCalls?.map((fc, i) => (
                    <pre key={i} className="scene-agent__call">
                      {fc.name}({JSON.stringify(fc.args ?? {})})
                    </pre>
                  ))}
                  {step.toolResults?.map((tr, i) => (
                    <pre key={`r-${i}`} className="scene-agent__result">
                      → {tr.name}: {JSON.stringify(tr.response)}
                    </pre>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
