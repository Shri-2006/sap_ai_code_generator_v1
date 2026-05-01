// index.js — SAP Coder backend server
// Exposes the four-model pipeline over HTTP with Server-Sent Events for streaming

import "dotenv/config";
import express from "express";
import cors from "cors";
import { runPipeline, setModelOverride, getSessionModels, clearSession } from "./pipeline.js";
import { listModels, isValidModel } from "./sapClient.js";
import { getToken } from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT ?? 3000;

// ── Health / auth test ────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  try {
    await getToken();
    res.json({ status: "ok", message: "SAP auth successful" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// ── List available models ────────────────────────────────────────────────
app.get("/models", (req, res) => {
  res.json({ models: listModels() });
});

// ── Get current session model config ────────────────────────────────────
app.get("/session/:sessionId/models", (req, res) => {
  res.json({ models: getSessionModels(req.params.sessionId) });
});

// ── Override a model for a role ──────────────────────────────────────────
// POST /session/:sessionId/model
// Body: { role: "codeGenerator", model: "claude-opus-4-6" }
app.post("/session/:sessionId/model", (req, res) => {
  const { role, model } = req.body;
  if (!role || !model) return res.status(400).json({ error: "role and model required" });
  if (!isValidModel(model)) return res.status(400).json({ error: `Unknown model: ${model}` });
  try {
    setModelOverride(req.params.sessionId, role, model);
    res.json({ ok: true, role, model });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Clear session memory ──────────────────────────────────────────────────
app.delete("/session/:sessionId", (req, res) => {
  clearSession(req.params.sessionId);
  res.json({ ok: true });
});

// ── Main pipeline endpoint (SSE streaming) ───────────────────────────────
// POST /run
// Body: { sessionId, task, fileContext? }
// Streams events as Server-Sent Events, then closes.
app.post("/run", async (req, res) => {
  const { sessionId, task, fileContext } = req.body;

  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  if (!task)      return res.status(400).json({ error: "task required" });

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await runPipeline({
      sessionId,
      task,
      fileContext: fileContext ?? "",
      onStep: (event, payload) => send(event, payload),
    });

    send("done", result);
  } catch (err) {
    send("error", { message: err.message });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`SAP Coder backend running on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  GET  /health");
  console.log("  GET  /models");
  console.log("  POST /run             — run the four-model pipeline");
  console.log("  GET  /session/:id/models");
  console.log("  POST /session/:id/model — override a model");
  console.log("  DEL  /session/:id     — clear memory");
});