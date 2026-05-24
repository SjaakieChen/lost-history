import { useState, type FormEvent } from 'react';
import './App.css';

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResponse('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      const data = (await res.json()) as {
        text?: string;
        thoughts?: string;
        model?: string;
        thinkingUsed?: boolean;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? 'Request failed');
      }

      const parts = [data.text ?? ''];
      if (data.thoughts) {
        parts.push(`\n\n[Thoughts]\n${data.thoughts}`);
      }
      if (data.model) {
        parts.push(`\n\n(Model: ${data.model}${data.thinkingUsed ? ', thinking' : ''})`);
      }

      setResponse(parts.join(''));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app">
      <header>
        <h1>Lost History</h1>
        <p>Ask Gemini a question. Your API key stays on the server.</p>
      </header>

      <form className="prompt-form" onSubmit={handleSubmit}>
        <label htmlFor="prompt">Prompt</label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="What historical mystery should we explore?"
          rows={4}
          required
        />
        <button type="submit" disabled={loading || !prompt.trim()}>
          {loading ? 'Thinking…' : 'Send to Gemini'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {response && (
        <section className="response">
          <h2>Response</h2>
          <p>{response}</p>
        </section>
      )}
    </main>
  );
}
