import { useState } from 'react';
import type {
  AgentStep,
  ChatMessage,
  GenerateTextUsage,
  LlmAgentDebug,
  LlmProviderRequestSnapshot,
} from '../../shared/gemini-types.js';

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  const [open, setOpen] = useState(false);
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="model-context__block" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      <pre className="model-context__json">{text}</pre>
    </details>
  );
}

function MessageLine({ message, index }: { message: ChatMessage; index: number }) {
  const role = message.role;
  const toolSuffix =
    role === 'tool' && message.toolName ? ` (${message.toolName})` : '';
  return (
    <div className={`model-context__message model-context__message--${role}`}>
      <span className="model-context__message-role">
        [{index}] {role}
        {toolSuffix}
        {message.model ? ` · ${message.model}` : ''}
      </span>
      <pre className="model-context__message-body">{message.content}</pre>
    </div>
  );
}

function StepView({ step }: { step: AgentStep }) {
  return (
    <li className="model-context__step">
      <div className="model-context__step-header">
        <strong>Step {step.step}</strong>
        <span>{step.model}</span>
        {step.durationMs != null && <span>{step.durationMs} ms</span>}
        {step.finishReason && <span>finish: {step.finishReason}</span>}
      </div>

      {step.providerRequest && (
        <ProviderRequestView request={step.providerRequest} title="Provider request (sent to API)" />
      )}

      {step.thoughts?.trim() && (
        <div className="model-context__section">
          <h5>Model thoughts (reasoning)</h5>
          <pre className="model-context__json">{step.thoughts}</pre>
        </div>
      )}

      {step.text?.trim() && (
        <div className="model-context__section">
          <h5>Assistant text</h5>
          <pre className="model-context__json">{step.text}</pre>
        </div>
      )}

      {step.functionCalls?.map((fc, i) => (
        <pre key={`fc-${i}`} className="model-context__json model-context__inline">
          functionCall: {fc.name}({JSON.stringify(fc.args ?? {}, null, 2)})
        </pre>
      ))}

      {step.toolResults?.map((tr, i) => (
        <pre key={`tr-${i}`} className="model-context__json model-context__inline">
          toolResult: {tr.name} → {JSON.stringify(tr.response, null, 2)}
        </pre>
      ))}
    </li>
  );
}

function ProviderRequestView({
  request,
  title,
}: {
  request: LlmProviderRequestSnapshot;
  title: string;
}) {
  return (
    <div className="model-context__section">
      <h5>{title}</h5>
      <p className="model-context__meta">
        {request.provider} · {request.registryKey} · API {request.apiModelId}
      </p>
      {request.systemInstruction && (
        <div className="model-context__section">
          <h6>systemInstruction</h6>
          <pre className="model-context__json">{request.systemInstruction}</pre>
        </div>
      )}
      <JsonBlock label="providerMessages (native thread)" value={request.providerMessages} />
      {request.tools?.length ? (
        <JsonBlock label="tools (declarations)" value={request.tools} />
      ) : null}
      {request.toolsConfig != null ||
      request.thinkingConfig != null ||
      request.structuredConfig != null ? (
        <JsonBlock
          label="request config (thinking / tools / structured)"
          value={{
            functionCallingMode: request.functionCallingMode,
            maxOutputTokens: request.maxOutputTokens,
            thinkingConfig: request.thinkingConfig,
            toolsConfig: request.toolsConfig,
            structuredConfig: request.structuredConfig,
          }}
        />
      ) : null}
    </div>
  );
}

function UsageLine({ usage }: { usage: GenerateTextUsage }) {
  return (
    <p className="model-context__meta">
      tokens — prompt: {usage.promptTokens ?? '?'}, output: {usage.candidatesTokens ?? '?'}, total:{' '}
      {usage.totalTokens ?? '?'}
      {usage.thoughtsTokens != null ? `, thoughts: ${usage.thoughtsTokens}` : ''}
    </p>
  );
}

interface ModelContextViewerProps {
  debug: LlmAgentDebug;
}

export default function ModelContextViewer({ debug }: ModelContextViewerProps) {
  const [showPortable, setShowPortable] = useState(true);

  return (
    <div className="model-context">
      <p className="model-context__intro">
        What the model saw on each step: native provider messages, system instruction, tool schemas,
        reasoning, and tool I/O. Portable <code>messages</code> below is the exported transcript used
        for cross-model chaining (not byte-identical to the provider payload).
      </p>

      {debug.sceneSystemInstruction && (
        <div className="model-context__section">
          <h4>Scene system instruction</h4>
          <pre className="model-context__json">{debug.sceneSystemInstruction}</pre>
        </div>
      )}

      {debug.effectiveSystemInstruction &&
        debug.effectiveSystemInstruction !== debug.sceneSystemInstruction && (
          <div className="model-context__section">
            <h4>Effective system instruction (incl. agent rules)</h4>
            <pre className="model-context__json">{debug.effectiveSystemInstruction}</pre>
          </div>
        )}

      {!debug.sceneSystemInstruction && debug.effectiveSystemInstruction && (
        <div className="model-context__section">
          <h4>System instruction</h4>
          <pre className="model-context__json">{debug.effectiveSystemInstruction}</pre>
        </div>
      )}

      <JsonBlock label={`Tool declarations (${debug.tools.length})`} value={debug.tools} />

      {debug.usage && <UsageLine usage={debug.usage} />}

      {debug.thoughts?.trim() && (
        <div className="model-context__section">
          <h4>Accumulated thoughts</h4>
          <pre className="model-context__json">{debug.thoughts}</pre>
        </div>
      )}

      <div className="model-context__section">
        <h4>Per-step provider context</h4>
        <ol className="model-context__steps">
          {debug.steps.map((step) => (
            <StepView key={step.step} step={step} />
          ))}
        </ol>
      </div>

      <div className="model-context__section">
        <button
          type="button"
          className="model-context__toggle"
          onClick={() => setShowPortable((v) => !v)}
        >
          {showPortable ? 'Hide' : 'Show'} portable transcript ({debug.messages.length} messages)
        </button>
        {showPortable && (
          <div className="model-context__messages">
            {debug.messages.map((message, index) => (
              <MessageLine key={index} message={message} index={index} />
            ))}
          </div>
        )}
      </div>

      {debug.finalProviderThread != null && (
        <JsonBlock label="Final native provider thread (after last step)" value={debug.finalProviderThread} />
      )}
    </div>
  );
}
