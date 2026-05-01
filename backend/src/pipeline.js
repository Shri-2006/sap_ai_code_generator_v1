// pipeline.js — Four-model pipeline orchestrator
// Manages isolated memory (chat history) per model role across a session.
// Runs: Sonnet (prompt) → Opus (generate) → Opus (check) → Haiku (final)

import { chat } from "./sapClient.js";
import { SYSTEM_PROMPTS, DEFAULT_MODELS } from "./prompts.js";

// In-memory store: sessionId → { memories: { role → history[] } }
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      memories: {
        promptEngineer: [],
        codeGenerator:  [],
        codeChecker:    [],
        finalCheck:     [],
      },
      models: { ...DEFAULT_MODELS },
    });
  }
  return sessions.get(sessionId);
}

export function setModelOverride(sessionId, role, model) {
  const session = getSession(sessionId);
  if (!(role in session.models)) throw new Error(`Unknown role: ${role}`);
  session.models[role] = model;
}

export function getSessionModels(sessionId) {
  return { ...getSession(sessionId).models };
}

export function clearSession(sessionId) {
  sessions.delete(sessionId);
}

/**
 * Run the full four-step pipeline for a coding task.
 *
 * @param {object} opts
 * @param {string} opts.sessionId    - Unique session identifier
 * @param {string} opts.task         - User's natural-language coding task
 * @param {string} opts.fileContext  - Relevant existing code (may be empty)
 * @param {function} opts.onStep     - Callback(stepName, content) for streaming updates
 * @returns {object} Full pipeline result
 */
export async function runPipeline({ sessionId, task, fileContext = "", onStep }) {
  const session = getSession(sessionId);
  const { memories, models } = session;

  const emit = (step, content) => onStep?.(step, content);

  // ── Step 1: Prompt Engineering ──────────────────────────────────────────
  emit("step", { step: 1, label: "Prompt engineer thinking…", model: models.promptEngineer });

  const userMsgForEngineer = fileContext
    ? `Task: ${task}\n\nExisting code context:\n\`\`\`\n${fileContext}\n\`\`\``
    : `Task: ${task}`;

  const { reply: engineeredPrompt, updatedHistory: engHistory } = await chat({
    model:        models.promptEngineer,
    systemPrompt: SYSTEM_PROMPTS.promptEngineer,
    history:      memories.promptEngineer,
    userMessage:  userMsgForEngineer,
  });
  memories.promptEngineer = engHistory;
  emit("result", { step: 1, label: "Engineered prompt", content: engineeredPrompt });

  // ── Step 2: Code Generation ─────────────────────────────────────────────
  emit("step", { step: 2, label: "Generating code…", model: models.codeGenerator });

  const { reply: generatedCode, updatedHistory: genHistory } = await chat({
    model:        models.codeGenerator,
    systemPrompt: SYSTEM_PROMPTS.codeGenerator,
    history:      memories.codeGenerator,
    userMessage:  engineeredPrompt,
    maxTokens:    8192,
  });
  memories.codeGenerator = genHistory;
  emit("result", { step: 2, label: "Generated code", content: generatedCode });

  // Parse files out of generator output
  const files = parseGeneratedFiles(generatedCode);
  emit("files", { files });

  // ── Step 3: Code Review ─────────────────────────────────────────────────
  emit("step", { step: 3, label: "Reviewing code…", model: models.codeChecker });

  const reviewInput = `Original requirements:\n${engineeredPrompt}\n\nGenerated code:\n${generatedCode}`;

  const { reply: reviewResult, updatedHistory: reviewHistory } = await chat({
    model:        models.codeChecker,
    systemPrompt: SYSTEM_PROMPTS.codeChecker,
    history:      memories.codeChecker,
    userMessage:  reviewInput,
  });
  memories.codeChecker = reviewHistory;
  emit("result", { step: 3, label: "Code review", content: reviewResult });

  const needsRegeneration = reviewResult.includes("REGENERATE: yes");

  // ── Step 3b: Auto-regenerate if checker says FAIL ───────────────────────
  let finalCode = generatedCode;
  let finalFiles = files;

  if (needsRegeneration) {
    emit("step", { step: "3b", label: "Regenerating after review…", model: models.codeGenerator });

    const regenPrompt = `${engineeredPrompt}\n\nPrevious attempt failed review. Issues to fix:\n${reviewResult}`;

    const { reply: regenCode, updatedHistory: regenHistory } = await chat({
      model:        models.codeGenerator,
      systemPrompt: SYSTEM_PROMPTS.codeGenerator,
      history:      memories.codeGenerator,
      userMessage:  regenPrompt,
      maxTokens:    8192,
    });
    memories.codeGenerator = regenHistory;
    finalCode = regenCode;
    finalFiles = parseGeneratedFiles(regenCode);
    emit("result", { step: "3b", label: "Regenerated code", content: regenCode });
    emit("files", { files: finalFiles });
  }

  // ── Step 4: Final Check ─────────────────────────────────────────────────
  emit("step", { step: 4, label: "Final security & lint check…", model: models.finalCheck });

  const { reply: finalVerdict, updatedHistory: finalHistory } = await chat({
    model:        models.finalCheck,
    systemPrompt: SYSTEM_PROMPTS.finalCheck,
    history:      memories.finalCheck,
    userMessage:  finalCode,
  });
  memories.finalCheck = finalHistory;
  emit("result", { step: 4, label: "Final check", content: finalVerdict });

  const approved = finalVerdict.includes("FINAL: PASS");

  return {
    approved,
    engineeredPrompt,
    generatedCode: finalCode,
    files: finalFiles,
    review: reviewResult,
    finalVerdict,
    models: { ...models },
    regenerated: needsRegeneration,
  };
}

/**
 * Parse ===FILE: path=== blocks out of generator output.
 * Returns [{ path, content }]
 */
function parseGeneratedFiles(output) {
  const files = [];
  const regex = /===FILE:\s*(.+?)===\n([\s\S]*?)(?====FILE:|$)/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    files.push({
      path:    match[1].trim(),
      content: match[2].trim(),
    });
  }
  return files;
}