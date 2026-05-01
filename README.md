# SAP Coder

A four-model AI coding agent powered by SAP AI Core, delivered as a VS Code extension.

## How the pipeline works

```
You (VS Code)
  │
  ▼
Step 1 — Sonnet 4.6 (Prompt Engineer)     [Memory A]
  Turns your task into a precise implementation spec
  │
  ▼
Step 2 — Opus 4.6 (Code Generator)        [Memory B]
  Generates complete files from the spec
  │
  ▼
Step 3 — Opus 4.6 (Code Checker)          [Memory C]
  Reviews for correctness, edge cases, logic errors
  │  (auto-regenerates if FAIL)
  ▼
Step 4 — Haiku 4.5 (Final Check)          [Memory D]
  Fast sweep: security, obvious bugs, formatting
  │
  ▼
Write files to your workspace
```

Each model has **isolated memory** — the checker never sees the generator's
reasoning, so it reviews the code cold, like a real peer reviewer would.

---

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
# Fill in your SAP credentials (see below)
npm install
npm start
```

Your `.env` needs these values from your **SAP BTP AI Core service key**:

| Variable | Where to find it |
|---|---|
| `SAP_AUTH_URL` | `uaa.url` + `/oauth/token` |
| `SAP_CLIENT_ID` | `uaa.clientid` |
| `SAP_CLIENT_SECRET` | `uaa.clientsecret` |
| `SAP_AI_CORE_BASE_URL` | `serviceurls.AI_API_URL` |
| `SAP_DEPLOYMENT_ID` | Your deployed SAP orchestration ID in AI Core |
| `SAP_RESOURCE_GROUP` | Usually `default` |

Test auth is working:
```bash
curl http://localhost:3000/health
# → {"status":"ok","message":"SAP auth successful"}
```

### 2. VS Code Extension

```bash
cd extension
npm install
npm run compile
```

Then in VS Code:
- Press `F5` to launch Extension Development Host, OR
- Package it: `npx vsce package` → install the `.vsix`

### 3. Using it

- Open the **SAP Coder** panel from the activity bar (CTRL+Shift+P), then (SAP C)
- Type a task and press **Run pipeline** (or Ctrl+Enter)
- Watch the four-step pipeline run in the log
- Click **Write N file(s) to workspace** to accept the output

---

## Changing models

In the extension panel, use the **SAP Coder: Change Model** command to swap
any pipeline step to a different Claude model. Defaults:

| Step | Default model |
|---|---|
| Prompt engineer | `claude-sonnet-4-6` |
| Code generator | `claude-opus-4-6` |
| Code checker | `claude-opus-4-6` |
| Final check | `claude-haiku-4-5-20251001` |

---

## Project structure

```
sap-coder/
├── backend/
│   ├── src/
│   │   ├── auth.js        — SAP OAuth token manager
│   │   ├── sapClient.js   — AI Core API client
│   │   ├── prompts.js     — System prompts for all four roles
│   │   ├── pipeline.js    — Four-step orchestrator + per-model memory
│   │   └── index.js       — Express server + SSE streaming
│   └── .env.example
└── extension/
    └── src/
        └── extension.ts   — VS Code extension (commands + webview panel)
```

---

## API reference (backend)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Test SAP auth |
| GET | `/models` | List available Claude models |
| POST | `/run` | Run the four-model pipeline (SSE stream) |
| GET | `/session/:id/models` | Get current model config for a session |
| POST | `/session/:id/model` | Override a model for a role |
| DELETE | `/session/:id` | Clear all memory for a session |

### POST /run body
```json
{
  "sessionId": "unique-string",
  "task": "Add JWT auth to the Express router",
  "fileContext": "// optional: paste relevant existing code here"
}
```