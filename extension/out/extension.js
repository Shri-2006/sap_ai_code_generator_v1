"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// extension.ts — SAP Coder VS Code extension entry point
const vscode = require("vscode");
const path = require("path");
const fs = require("fs/promises");
const uuid_1 = require("uuid"); // pulled in via npm install
let sessionId = (0, uuid_1.v4)();
let panel;
function activate(context) {
    console.log("SAP Coder activated");
    // ── Open Panel command ────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("sapCoder.openPanel", () => {
        openPanel(context);
    }));
    // ── Run Task command (quick-pick shortcut) ────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("sapCoder.run", async () => {
        const task = await vscode.window.showInputBox({
            prompt: "What should SAP Coder build?",
            placeHolder: "e.g. Add JWT authentication to the Express router",
        });
        if (!task)
            return;
        openPanel(context);
        // Short delay to let the webview mount
        setTimeout(() => {
            panel?.webview.postMessage({ type: "startTask", task });
        }, 500);
    }));
    // ── Change model command ──────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("sapCoder.setModel", async () => {
        const config = vscode.workspace.getConfiguration("sapCoder");
        const backendUrl = config.get("backendUrl") ?? "http://localhost:3000";
        const res = await fetch(`${backendUrl}/models`);
        const { models } = (await res.json());
        const roles = ["promptEngineer", "codeGenerator", "codeChecker", "finalCheck"];
        const role = await vscode.window.showQuickPick(roles, {
            placeHolder: "Which pipeline step?",
        });
        if (!role)
            return;
        const model = await vscode.window.showQuickPick(models, {
            placeHolder: "Choose model",
        });
        if (!model)
            return;
        await fetch(`${backendUrl}/session/${sessionId}/model`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role, model }),
        });
        vscode.window.showInformationMessage(`${role} → ${model}`);
    }));
}
function openPanel(context) {
    if (panel) {
        panel.reveal();
        return;
    }
    panel = vscode.window.createWebviewPanel("sapCoder", "SAP Coder", vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
    });
    panel.webview.html = getPanelHtml();
    // ── Messages from webview ─────────────────────────────────────────────
    panel.webview.onDidReceiveMessage(async (msg) => {
        const config = vscode.workspace.getConfiguration("sapCoder");
        const backendUrl = config.get("backendUrl") ?? "http://localhost:3000";
        if (msg.type === "runTask") {
            await runTask({ backendUrl, task: msg.task, fileContext: msg.fileContext });
        }
        if (msg.type === "writeFiles") {
            await writeFilesToWorkspace(msg.files);
        }
        if (msg.type === "getFileContext") {
            const context = await gatherFileContext();
            panel?.webview.postMessage({ type: "fileContext", context });
        }
        if (msg.type === "clearSession") {
            sessionId = (0, uuid_1.v4)();
            await fetch(`${backendUrl}/session/${sessionId}`, { method: "DELETE" });
            panel?.webview.postMessage({ type: "sessionCleared" });
        }
    }, undefined, context.subscriptions);
    panel.onDidDispose(() => {
        panel = undefined;
    });
}
async function runTask({ backendUrl, task, fileContext, }) {
    const res = await fetch(`${backendUrl}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, task, fileContext }),
    });
    if (!res.body)
        return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        // Parse SSE events
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const eventBlock of events) {
            const lines = eventBlock.split("\n");
            const eventLine = lines.find((l) => l.startsWith("event:"));
            const dataLine = lines.find((l) => l.startsWith("data:"));
            if (!eventLine || !dataLine)
                continue;
            const event = eventLine.replace("event: ", "").trim();
            const data = JSON.parse(dataLine.replace("data: ", "").trim());
            panel?.webview.postMessage({ type: "pipelineEvent", event, data });
        }
    }
}
async function writeFilesToWorkspace(files) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        vscode.window.showErrorMessage("No workspace folder open.");
        return;
    }
    for (const file of files) {
        const fullPath = path.join(workspaceRoot, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, "utf8");
    }
    vscode.window.showInformationMessage(`Wrote ${files.length} file(s) to workspace.`);
    // Show diff of first file
    if (files.length > 0) {
        const uri = vscode.Uri.file(path.join(workspaceRoot, files[0].path));
        await vscode.commands.executeCommand("vscode.open", uri);
    }
}
async function gatherFileContext() {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return "";
    const selection = editor.selection;
    if (!selection.isEmpty) {
        return editor.document.getText(selection);
    }
    return editor.document.getText();
}
function deactivate() { }
// ── Webview HTML ──────────────────────────────────────────────────────────
function getPanelHtml() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SAP Coder</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-font-family); font-size: 13px;
         color: var(--vscode-foreground); background: var(--vscode-editor-background);
         display: flex; flex-direction: column; height: 100vh; padding: 12px; gap: 10px; }
  textarea { width: 100%; height: 80px; resize: vertical; padding: 8px;
             background: var(--vscode-input-background); color: var(--vscode-input-foreground);
             border: 1px solid var(--vscode-input-border); border-radius: 4px;
             font-family: inherit; font-size: 13px; }
  .row { display: flex; gap: 8px; }
  button { padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer;
           background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground);
                     color: var(--vscode-button-secondaryForeground); }
  #log { flex: 1; overflow-y: auto; background: var(--vscode-terminal-background, #1e1e1e);
         color: var(--vscode-terminal-foreground, #d4d4d4); border-radius: 4px;
         padding: 10px; font-family: var(--vscode-editor-font-family, monospace);
         font-size: 12px; white-space: pre-wrap; }
  .step  { color: #4ec9b0; font-weight: bold; }
  .result { color: #9cdcfe; }
  .files { color: #ce9178; }
  .done  { color: #6a9955; font-weight: bold; }
  .error { color: #f44747; }
  #status { font-size: 11px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<textarea id="task" placeholder="Describe what you want to build or fix…"></textarea>
<div class="row">
  <button onclick="run()">Run pipeline</button>
  <button class="secondary" onclick="addContext()">Add file context</button>
  <button class="secondary" onclick="clearSession()">Clear memory</button>
</div>
<span id="status">Ready</span>
<div id="log"></div>
<script>
  const vscode = acquireVsCodeApi();
  let fileContext = "";

  function log(cls, text) {
    const el = document.getElementById('log');
    el.innerHTML += '<span class="' + cls + '">' + escHtml(text) + '</span>\\n';
    el.scrollTop = el.scrollHeight;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function run() {
    const task = document.getElementById('task').value.trim();
    if (!task) return;
    document.getElementById('log').textContent = '';
    document.getElementById('status').textContent = 'Running…';
    vscode.postMessage({ type: 'runTask', task, fileContext });
  }

  function addContext() {
    vscode.postMessage({ type: 'getFileContext' });
  }

  function clearSession() {
    vscode.postMessage({ type: 'clearSession' });
    document.getElementById('log').textContent = '';
    document.getElementById('status').textContent = 'Session cleared';
  }

  window.addEventListener('message', e => {
    const msg = e.data;

    if (msg.type === 'startTask') {
      document.getElementById('task').value = msg.task;
      run();
    }

    if (msg.type === 'fileContext') {
      fileContext = msg.context;
      document.getElementById('status').textContent =
        'File context loaded (' + fileContext.length + ' chars)';
    }

    if (msg.type === 'sessionCleared') {
      document.getElementById('status').textContent = 'Memory cleared — new session started';
    }

    if (msg.type === 'pipelineEvent') {
      const { event, data } = msg;

      if (event === 'step') {
        log('step', '[Step ' + data.step + '] ' + data.label + ' (' + data.model + ')');
      }
      if (event === 'result') {
        log('result', '--- ' + data.label + ' ---\\n' + data.content);
      }
      if (event === 'files') {
        const names = data.files.map(f => f.path).join(', ');
        log('files', 'Files: ' + names);
      }
      if (event === 'done') {
        const d = data;
        log('done', '\\n=== DONE ==='
          + '\\nApproved: ' + d.approved
          + '\\nRegenerated: ' + d.regenerated
          + '\\nModels: ' + JSON.stringify(d.models, null, 2));
        document.getElementById('status').textContent =
          d.approved ? 'Pipeline complete — approved' : 'Pipeline complete — check warnings';

        if (d.files && d.files.length > 0) {
          const writeBtn = document.createElement('button');
          writeBtn.textContent = 'Write ' + d.files.length + ' file(s) to workspace';
          writeBtn.onclick = () => vscode.postMessage({ type: 'writeFiles', files: d.files });
          document.getElementById('log').appendChild(writeBtn);
        }
      }
      if (event === 'error') {
        log('error', 'ERROR: ' + data.message);
        document.getElementById('status').textContent = 'Error — see log';
      }
    }
  });

  // Keyboard shortcut: Ctrl/Cmd+Enter to run
  document.getElementById('task').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') run();
  });
</script>
</body>
</html>`;
}
//# sourceMappingURL=extension.js.map