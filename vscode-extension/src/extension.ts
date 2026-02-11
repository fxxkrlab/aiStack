import * as vscode from "vscode";
import { spawn } from "child_process";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

type Provider = "openai" | "anthropic" | "gemini" | "custom";

type SavePayload = {
  brainProvider: Provider;
  brainApiUrl: string;
  brainModel: string;
  brainApiKey: string;
  workerProvider: Provider;
  workerApiUrl: string;
  workerModel: string;
  workerApiKey: string;
  workerTimeoutSec: number;
  fullAuto: boolean;
  dangerCodex: boolean;
  dangerClaude: boolean;
  dangerGemini: boolean;
};

type PanelMessage =
  | { type: "saveConfig"; payload: SavePayload }
  | { type: "initRoadmap" }
  | { type: "newTask" }
  | { type: "runWorker" };

const BRAIN_KEY_SECRET = "aiStack.brain.apiKey";
const WORKER_KEY_SECRET = "aiStack.worker.apiKey";
let output: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("AIStack");
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand("aiStack.openControlPanel", async () => {
      await openControlPanel(context);
    }),
    vscode.commands.registerCommand("aiStack.initRoadmap", async () => {
      await initRoadmap();
    }),
    vscode.commands.registerCommand("aiStack.newTask", async () => {
      await createTaskPackage();
    }),
    vscode.commands.registerCommand("aiStack.runWorker", async () => {
      await runWorker(context);
    })
  );
}

export function deactivate(): void {}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getNodePath(): string {
  return String(vscode.workspace.getConfiguration().get("aiStack.nodePath", "node"));
}

function getBrainScriptPath(workspace: string): string {
  return path.join(workspace, "dist", "scripts", "brain.js");
}

async function openControlPanel(context: vscode.ExtensionContext): Promise<void> {
  const panel = vscode.window.createWebviewPanel("aiStackControlPanel", "AIStack Control Panel", vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = await getPanelHtml(context);

  panel.webview.onDidReceiveMessage(async (message: PanelMessage) => {
    if (message.type === "saveConfig") {
      await saveConfig(context, message.payload);
      return;
    }
    if (message.type === "initRoadmap") {
      await vscode.commands.executeCommand("aiStack.initRoadmap");
      return;
    }
    if (message.type === "newTask") {
      await vscode.commands.executeCommand("aiStack.newTask");
      return;
    }
    if (message.type === "runWorker") {
      await vscode.commands.executeCommand("aiStack.runWorker");
    }
  });
}

async function getPanelHtml(context: vscode.ExtensionContext): Promise<string> {
  const config = vscode.workspace.getConfiguration();
  const initial = {
    brainProvider: String(config.get("aiStack.brain.provider", "openai")),
    brainApiUrl: String(config.get("aiStack.brain.apiUrl", "")),
    brainModel: String(config.get("aiStack.brain.model", "")),
    workerProvider: String(config.get("aiStack.worker.provider", "anthropic")),
    workerApiUrl: String(config.get("aiStack.worker.apiUrl", "")),
    workerModel: String(config.get("aiStack.worker.model", "")),
    workerTimeoutSec: Number(config.get("aiStack.worker.timeoutSec", 180)),
    fullAuto: Boolean(config.get("aiStack.automation.fullAuto", false)),
    dangerCodex: Boolean(config.get("aiStack.permissions.dangerous.codex", false)),
    dangerClaude: Boolean(config.get("aiStack.permissions.dangerous.claude", false)),
    dangerGemini: Boolean(config.get("aiStack.permissions.dangerous.gemini", false)),
    hasBrainKey: !!(await context.secrets.get(BRAIN_KEY_SECRET)),
    hasWorkerKey: !!(await context.secrets.get(WORKER_KEY_SECRET)),
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AIStack Control Panel</title>
    <style>
      body { font-family: ui-sans-serif, -apple-system, Segoe UI, sans-serif; padding: 16px; }
      h2 { margin-top: 0; }
      fieldset { margin-bottom: 16px; border: 1px solid #444; padding: 12px; }
      label { display: block; margin-bottom: 8px; font-size: 12px; }
      input, select { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; }
      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .buttons { display: flex; gap: 8px; flex-wrap: wrap; }
      .checkbox { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
      .checkbox input { width: auto; margin-top: 0; }
      button { padding: 8px 12px; cursor: pointer; }
      small { opacity: 0.8; }
    </style>
  </head>
  <body>
    <h2>AIStack Control Panel</h2>
    <fieldset>
      <legend>Automation & Permissions</legend>
      <label class="checkbox"><input id="fullAuto" type="checkbox" />Enable full automation (all dangerous permissions on)</label>
      <label class="checkbox"><input id="dangerCodex" type="checkbox" />Enable Codex dangerous permissions</label>
      <label class="checkbox"><input id="dangerClaude" type="checkbox" />Enable Claude dangerous permissions</label>
      <label class="checkbox"><input id="dangerGemini" type="checkbox" />Enable Gemini dangerous permissions</label>
    </fieldset>
    <fieldset>
      <legend>Brain</legend>
      <label>Provider
        <select id="brainProvider">
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
          <option value="gemini">gemini</option>
          <option value="custom">custom</option>
        </select>
      </label>
      <label>API URL
        <input id="brainApiUrl" placeholder="https://..." />
      </label>
      <label>Model
        <input id="brainModel" placeholder="gpt-4.1 / claude-sonnet / gemini-1.5-pro ..." />
      </label>
      <label>API Key (stored in VSCode SecretStorage)
        <input id="brainApiKey" type="password" placeholder="Leave empty to keep existing" />
      </label>
      <small id="brainKeyStatus"></small>
    </fieldset>

    <fieldset>
      <legend>Worker</legend>
      <label>Provider
        <select id="workerProvider">
          <option value="openai">openai</option>
          <option value="anthropic">anthropic</option>
          <option value="gemini">gemini</option>
          <option value="custom">custom</option>
        </select>
      </label>
      <label>API URL
        <input id="workerApiUrl" placeholder="https://..." />
      </label>
      <div class="row">
        <label>Model
          <input id="workerModel" placeholder="gpt-4.1-mini / claude-3-5-sonnet / gemini..." />
        </label>
        <label>Timeout (sec)
          <input id="workerTimeoutSec" type="number" min="10" step="1" />
        </label>
      </div>
      <label>API Key (stored in VSCode SecretStorage)
        <input id="workerApiKey" type="password" placeholder="Leave empty to keep existing" />
      </label>
      <small id="workerKeyStatus"></small>
    </fieldset>

    <div class="buttons">
      <button id="saveBtn">Save Config</button>
      <button id="initBtn">Init Roadmap</button>
      <button id="taskBtn">New Task Package</button>
      <button id="runBtn">Run Worker</button>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      const initial = ${JSON.stringify(initial)};

      function setValue(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value ?? "";
      }
      function setChecked(id, checked) {
        const el = document.getElementById(id);
        if (el) el.checked = !!checked;
      }

      setValue("brainProvider", initial.brainProvider);
      setValue("brainApiUrl", initial.brainApiUrl);
      setValue("brainModel", initial.brainModel);
      setValue("workerProvider", initial.workerProvider);
      setValue("workerApiUrl", initial.workerApiUrl);
      setValue("workerModel", initial.workerModel);
      setValue("workerTimeoutSec", String(initial.workerTimeoutSec));
      setChecked("fullAuto", initial.fullAuto);
      setChecked("dangerCodex", initial.dangerCodex);
      setChecked("dangerClaude", initial.dangerClaude);
      setChecked("dangerGemini", initial.dangerGemini);
      document.getElementById("brainKeyStatus").innerText = initial.hasBrainKey
        ? "Brain API key already set."
        : "Brain API key not set.";
      document.getElementById("workerKeyStatus").innerText = initial.hasWorkerKey
        ? "Worker API key already set."
        : "Worker API key not set.";

      document.getElementById("saveBtn").addEventListener("click", () => {
        vscode.postMessage({
          type: "saveConfig",
          payload: {
            brainProvider: document.getElementById("brainProvider").value,
            brainApiUrl: document.getElementById("brainApiUrl").value,
            brainModel: document.getElementById("brainModel").value,
            brainApiKey: document.getElementById("brainApiKey").value,
            workerProvider: document.getElementById("workerProvider").value,
            workerApiUrl: document.getElementById("workerApiUrl").value,
            workerModel: document.getElementById("workerModel").value,
            workerApiKey: document.getElementById("workerApiKey").value,
            workerTimeoutSec: Number(document.getElementById("workerTimeoutSec").value || 180),
            fullAuto: !!document.getElementById("fullAuto").checked,
            dangerCodex: !!document.getElementById("dangerCodex").checked,
            dangerClaude: !!document.getElementById("dangerClaude").checked,
            dangerGemini: !!document.getElementById("dangerGemini").checked
          }
        });
      });

      document.getElementById("initBtn").addEventListener("click", () => vscode.postMessage({ type: "initRoadmap" }));
      document.getElementById("taskBtn").addEventListener("click", () => vscode.postMessage({ type: "newTask" }));
      document.getElementById("runBtn").addEventListener("click", () => vscode.postMessage({ type: "runWorker" }));
    </script>
  </body>
</html>`;
}

async function saveConfig(context: vscode.ExtensionContext, payload: SavePayload): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update("aiStack.brain.provider", payload.brainProvider, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.brain.apiUrl", payload.brainApiUrl, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.brain.model", payload.brainModel, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.worker.provider", payload.workerProvider, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.worker.apiUrl", payload.workerApiUrl, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.worker.model", payload.workerModel, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.worker.timeoutSec", payload.workerTimeoutSec, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.automation.fullAuto", payload.fullAuto, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.permissions.dangerous.codex", payload.dangerCodex, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.permissions.dangerous.claude", payload.dangerClaude, vscode.ConfigurationTarget.Workspace);
  await cfg.update("aiStack.permissions.dangerous.gemini", payload.dangerGemini, vscode.ConfigurationTarget.Workspace);

  if (payload.brainApiKey.trim()) {
    await context.secrets.store(BRAIN_KEY_SECRET, payload.brainApiKey.trim());
  }
  if (payload.workerApiKey.trim()) {
    await context.secrets.store(WORKER_KEY_SECRET, payload.workerApiKey.trim());
  }
  vscode.window.showInformationMessage("AIStack settings saved.");
}

async function runBrainCommand(args: string[]): Promise<number> {
  const workspace = getWorkspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return 2;
  }
  const script = getBrainScriptPath(workspace);
  if (!fs.existsSync(script)) {
    vscode.window.showErrorMessage("Missing dist/scripts/brain.js. Run `npm install && npm run build` at workspace root.");
    return 2;
  }

  output.show(true);
  output.appendLine(`$ ${getNodePath()} ${script} ${args.join(" ")}`);

  return await new Promise<number>((resolve) => {
    const child = spawn(getNodePath(), [script, ...args], { cwd: workspace, env: process.env });
    child.stdout.on("data", (chunk: Buffer) => output.append(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => output.append(chunk.toString()));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function initRoadmap(): Promise<void> {
  const goal = await vscode.window.showInputBox({
    prompt: "Roadmap goal",
    placeHolder: "在这个仓库打造可复用的 AI 协作开发框架",
  });
  if (!goal) {
    return;
  }
  const code = await runBrainCommand(["init", "--goal", goal]);
  if (code === 0) {
    vscode.window.showInformationMessage("Roadmap initialized.");
  } else {
    vscode.window.showErrorMessage(`Init roadmap failed (exit ${code}). Check output panel.`);
  }
}

async function createTaskPackage(): Promise<void> {
  const round = (await vscode.window.showInputBox({ prompt: "Round ID", value: "R01" })) || "R01";
  const title = await vscode.window.showInputBox({ prompt: "Task title" });
  if (!title) {
    return;
  }
  const goal = await vscode.window.showInputBox({ prompt: "Task goal" });
  if (!goal) {
    return;
  }
  const scope = (await vscode.window.showInputBox({ prompt: "Task scope" })) || "";
  const files = (await vscode.window.showInputBox({ prompt: "In-scope files/paths (comma-separated)" })) || "";
  const acceptance = (await vscode.window.showInputBox({ prompt: "Acceptance criteria (semicolon-separated)" })) || "";

  const args = ["new-task", "--round", round, "--title", title, "--goal", goal, "--scope", scope, "--files", files, "--acceptance", acceptance];
  const code = await runBrainCommand(args);
  if (code === 0) {
    vscode.window.showInformationMessage("Task package created.");
  } else {
    vscode.window.showErrorMessage(`Create task failed (exit ${code}). Check output panel.`);
  }
}

async function listTaskDirs(workspace: string): Promise<string[]> {
  const root = path.join(workspace, "rounds");
  async function walk(dir: string): Promise<string[]> {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
    const found: string[] = [];
    for (const d of dirs) {
      const hasSpec = await fsp
        .access(path.join(d, "TaskSpec.md"))
        .then(() => true)
        .catch(() => false);
      if (hasSpec) {
        found.push(d);
      }
      const nested = await walk(d);
      found.push(...nested);
    }
    return found;
  }
  return walk(root);
}

async function runWorker(context: vscode.ExtensionContext): Promise<void> {
  const workspace = getWorkspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }
  const taskDirs = await listTaskDirs(workspace);
  if (!taskDirs.length) {
    vscode.window.showErrorMessage("No task folders found under rounds/.");
    return;
  }
  const picked = await vscode.window.showQuickPick(taskDirs.map((d) => path.relative(workspace, d)), {
    placeHolder: "Select task directory",
  });
  if (!picked) {
    return;
  }
  const mode = await vscode.window.showQuickPick(["claude", "provider_api"], { placeHolder: "Worker backend" });
  if (!mode) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration();
  const timeout = Number(cfg.get("aiStack.worker.timeoutSec", 180));
  const args = ["run-worker", "--task-dir", path.join(workspace, picked), "--worker", mode, "--timeout-sec", String(timeout)];

  if (mode === "provider_api") {
    const provider = String(cfg.get("aiStack.worker.provider", "anthropic"));
    const apiUrl = String(cfg.get("aiStack.worker.apiUrl", ""));
    const model = String(cfg.get("aiStack.worker.model", ""));
    const apiKey = (await context.secrets.get(WORKER_KEY_SECRET)) || "";
    if (!model) {
      vscode.window.showErrorMessage("Set `aiStack.worker.model` first.");
      return;
    }
    args.push("--provider", provider, "--model", model);
    if (apiUrl) {
      args.push("--api-url", apiUrl);
    }
    if (apiKey) {
      args.push("--api-key", apiKey);
    }
  }

  const fullAuto = Boolean(cfg.get("aiStack.automation.fullAuto", false));
  const dangerClaude = Boolean(cfg.get("aiStack.permissions.dangerous.claude", false));
  if (mode === "claude" && (fullAuto || dangerClaude)) {
    args.push("--dangerous-permissions");
  }

  const code = await runBrainCommand(args);
  if (code === 0) {
    vscode.window.showInformationMessage("Worker run finished.");
  } else {
    vscode.window.showErrorMessage(`Worker run finished with exit ${code}. Check output panel.`);
  }
}

