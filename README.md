# Localize Extractor

A browser-based tool for turning UI screenshots into localization key/value pairs. Upload an image, let OCR detect the text, select the words you care about, and generate camelCase localization keys — either with a local LLM or a built-in offline fallback. The result is exported as a ready-to-use JSON object.

## Features

- **In-browser OCR** — text is detected client-side with [Tesseract.js](https://github.com/naptha/tesseract.js) (English), no image ever leaves your machine.
- **Word selection** — click or drag-select detected words on the image; adjacent words can be merged into a single phrase in reading order.
- **AI key generation** — selected text is converted into short camelCase keys (e.g. `Please enter your email` → `labelEnterEmail`) using a local [Ollama](https://ollama.com) model.
- **Offline fallback** — if the backend/LLM is unavailable, keys are generated locally with a stop-word + camelCase heuristic.
- **Live JSON output** — an editable `{ "key": "value" }` object updates as you select and rename keys.
- **Zoom & pan** — Ctrl/Cmd + scroll (or trackpad pinch) to zoom into dense screenshots.

## Project structure

```
localize-extractor/
├── frontend/   # React + Vite + TypeScript UI (OCR, selection, JSON export)
└── backend/    # Express + TypeScript API that proxies to a local Ollama model
```

## Requirements

- [Node.js](https://nodejs.org) 18+
- [Ollama](https://ollama.com) running locally (for AI key generation) with the `llama3.1` model:
  ```bash
  ollama pull llama3.1
  ```
  > Without Ollama the app still works using the offline key-generation fallback.

## Getting started

### 1. Backend (key-generation API)

```bash
cd backend
npm install
npm start
```

Runs on `http://localhost:3001` and forwards requests to Ollama at `http://localhost:11434`. To use a different model, edit `model` in [backend/index.ts](backend/index.ts).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`).

## Usage

1. Upload a screenshot containing UI text.
2. Wait for OCR to detect words (progress is shown on the image).
3. Click or drag to select the words/phrases you want to localize.
4. Generated camelCase keys appear alongside the selected text; edit keys or values as needed.
5. Copy the JSON output for use in your localization files.

## Scripts

**Frontend**
- `npm run dev` — start the Vite dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run oxlint

**Backend**
- `npm start` — run the API with ts-node

## Tech stack

React 19 · Vite · TypeScript · Tesseract.js · Express · Ollama

## License

ISC
