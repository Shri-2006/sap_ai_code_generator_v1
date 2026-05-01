// sapClient.js — low-level SAP AI Core Orchestration Service client
// Handles chat completions with a given model, maintaining per-model message history

import { getToken } from "./auth.js";

const AVAILABLE_MODELS = {
  "anthropic--claude-4.6-sonnet": "anthropic--claude-4.6-sonnet",
  "anthropic--claude-4.6-opus":   "anthropic--claude-4.6-opus",
  "anthropic--claude-4.5-haiku":  "anthropic--claude-4.5-haiku",
  "anthropic--claude-4.5-sonnet": "anthropic--claude-4.5-sonnet",
  "anthropic--claude-4.5-opus":   "anthropic--claude-4.5-opus",
  "anthropic--claude-4-sonnet":   "anthropic--claude-4-sonnet",
  "anthropic--claude-4-opus":     "anthropic--claude-4-opus",
  "anthropic--claude-3.7-sonnet": "anthropic--claude-3.7-sonnet",
  "anthropic--claude-3-haiku":    "anthropic--claude-3-haiku",
};

export function isValidModel(model) {
  return model in AVAILABLE_MODELS;
}

export function listModels() {
  return Object.keys(AVAILABLE_MODELS);
}

/**
 * Send a message to SAP AI Core Orchestration Service.
 *
 * @param {object} opts
 * @param {string}   opts.model         - Model ID (e.g. "claude-sonnet-4-6")
 * @param {string}   opts.systemPrompt  - System prompt for this model's role
 * @param {Array}    opts.history        - Prior messages [{role, content}]
 * @param {string}   opts.userMessage   - New user message to send
 * @param {number}   [opts.maxTokens]   - Max tokens (default 4096)
 * @returns {{ reply: string, updatedHistory: Array }}
 */
export async function chat({ model, systemPrompt, history, userMessage, maxTokens = 4096 }) {
  const { SAP_AI_CORE_BASE_URL, SAP_DEPLOYMENT_ID } = process.env;

  if (!SAP_AI_CORE_BASE_URL) throw new Error("Missing SAP_AI_CORE_BASE_URL in .env");
  if (!SAP_DEPLOYMENT_ID)    throw new Error("Missing SAP_DEPLOYMENT_ID in .env");

  const token = await getToken();

  // Build messages array with optional system message
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  for (const m of history) messages.push(m);
  messages.push({ role: "user", content: userMessage });

  // SAP Orchestration Service format
  const url = `${SAP_AI_CORE_BASE_URL}/v2/inference/deployments/${SAP_DEPLOYMENT_ID}/completion`;

  const body = {
    orchestration_config: {
      module_configurations: {
        templating_module_config: {
          template: messages.map(m => ({ role: m.role, content: m.content }))
        },
        llm_module_config: {
          model_name:   model,
          model_params: { max_tokens: maxTokens }
        }
      }
    },
    input_params: {}
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization":     `Bearer ${token}`,
      "Content-Type":      "application/json",
      "AI-Resource-Group": process.env.SAP_RESOURCE_GROUP ?? "default",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SAP AI Core error (${res.status}) for model ${model}: ${text}`);
  }

  const data = await res.json();

  // SAP wraps the response differently — extract the content
  const reply = data.orchestration_result?.choices?.[0]?.message?.content
             ?? data.choices?.[0]?.message?.content
             ?? "";

  const updatedHistory = [
    ...history,
    { role: "user",      content: userMessage },
    { role: "assistant", content: reply },
  ];

  return { reply, updatedHistory };
}