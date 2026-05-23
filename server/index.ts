import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import { generateText } from './gemini.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };

    if (!prompt?.trim()) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const text = await generateText(prompt.trim());
    res.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
