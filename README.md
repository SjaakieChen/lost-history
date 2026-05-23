# Lost History

A React + TypeScript web app powered by the Google Gemini API. Prompts are sent through a small Express backend so your API key never reaches the browser.

## Prerequisites

- Node.js 18 or later
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and add your API key:

   ```bash
   copy .env.example .env
   ```

   Edit `.env` and set:

   ```env
   GEMINI_API_KEY=your_key_here
   ```

3. Test the Gemini connection:

   ```bash
   npm run test:gemini
   ```

   If the key is missing, the script exits with: `Add GEMINI_API_KEY to .env`.

4. Start the app:

   ```bash
   npm run dev
   ```

   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Runs the Vite frontend and Express API together |
| `npm run build` | Type-checks and builds the frontend |
| `npm run test:gemini` | Sends a test prompt to Gemini using your `.env` key |

## Project structure

```
├── server/           Express API (Gemini calls stay server-side)
├── scripts/          CLI utilities (test-gemini)
├── src/              React frontend
├── .env.example      Environment template (safe to commit)
└── vite.config.ts    Proxies /api to the Express server in dev
```

## GitHub

After adding your API key locally, push this repo to GitHub:

```bash
gh repo create lost-history --public --source=. --remote=origin
git push -u origin main
```

Adjust the repo name and visibility as needed.

## Security

- Never commit `.env` or expose `GEMINI_API_KEY` in frontend code.
- The React app only talks to `/api/chat`; the Express server holds the key.
