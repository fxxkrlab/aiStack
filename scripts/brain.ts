#!/usr/bin/env node
import { promises as fs } from "fs";
import { existsSync } from "fs";
import * as path from "path";
import { spawn } from "child_process";
import * as http from "http";
import * as https from "https";
import { URL } from "url";

type JsonMap = Record<string, unknown>;
type FlagValue = string | boolean;
type Flags = Record<string, FlagValue>;

type RoutedTask = {
  skills: string[];
  mcpTools: string[];
  matchedKeywords: string[];
  profiles: string[];
};

type HttpResult = {
  status: number;
  parsed: JsonMap;
  raw: string;
};

type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

const ROOT = path.resolve(process.cwd());
const CONFIG = path.join(ROOT, "config", "router_rules.json");
const STATE_DIR = path.join(ROOT, "state");
const ROUNDS_DIR = path.join(ROOT, "rounds");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const ROADMAP_JSON = path.join(STATE_DIR, "roadmap.json");
const ROADMAP_MD = path.join(ROOT, "ROADMAP.md");

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function asciiSlug(value: string, fallback = "task"): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized ? normalized.slice(0, 48) : fallback;
}

function parseFlags(args: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function getFlagString(flags: Flags, key: string, fallback = ""): string {
  const value = flags[key];
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

function getFlagBool(flags: Flags, key: string): boolean {
  return flags[key] === true;
}

async function readJson(filePath: string): Promise<JsonMap> {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as JsonMap;
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${content.replace(/\s+$/g, "")}\n`, "utf-8");
}

async function writeJson(filePath: string, data: JsonMap): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

async function loadTemplate(name: string): Promise<string> {
  return fs.readFile(path.join(TEMPLATES_DIR, name), "utf-8");
}

function renderTemplate(template: string, params: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function toStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((x) => String(x));
}

function routeTask(text: string, rules: JsonMap): RoutedTask {
  const haystack = text.toLowerCase();
  const defaultSkills = toStringArray(rules.default_skills);
  const selectedSkills = [...defaultSkills];
  const selectedProfiles = new Set<string>(["base"]);
  const matched = new Set<string>();

  const keywordRoutes = Array.isArray(rules.keyword_routes) ? rules.keyword_routes : [];
  for (const route of keywordRoutes) {
    if (!route || typeof route !== "object") {
      continue;
    }
    const routeObj = route as JsonMap;
    const keywords = toStringArray(routeObj.keywords).map((k) => k.toLowerCase());
    if (!keywords.some((k) => haystack.includes(k))) {
      continue;
    }
    for (const skill of toStringArray(routeObj.skills)) {
      if (!selectedSkills.includes(skill)) {
        selectedSkills.push(skill);
      }
    }
    for (const key of keywords) {
      if (haystack.includes(key)) {
        matched.add(key);
      }
    }
  }

  const profileRules = Array.isArray(rules.profile_rules) ? rules.profile_rules : [];
  for (const rule of profileRules) {
    if (!rule || typeof rule !== "object") {
      continue;
    }
    const ruleObj = rule as JsonMap;
    const keywords = toStringArray(ruleObj.keywords).map((k) => k.toLowerCase());
    if (!keywords.some((k) => haystack.includes(k))) {
      continue;
    }
    for (const profile of toStringArray(ruleObj.profiles)) {
      selectedProfiles.add(profile);
    }
    for (const key of keywords) {
      if (haystack.includes(key)) {
        matched.add(key);
      }
    }
  }

  const mcpProfiles = (rules.mcp_profiles as JsonMap) || {};
  const tools: string[] = [];
  for (const profile of Array.from(selectedProfiles).sort()) {
    const pTools = toStringArray(mcpProfiles[profile]);
    for (const tool of pTools) {
      if (!tools.includes(tool)) {
        tools.push(tool);
      }
    }
  }

  return {
    skills: selectedSkills,
    mcpTools: tools,
    matchedKeywords: Array.from(matched).sort(),
    profiles: Array.from(selectedProfiles).sort(),
  };
}

async function detectNextTaskNum(roundDir: string): Promise<number> {
  if (!existsSync(roundDir)) {
    return 1;
  }
  const entries = await fs.readdir(roundDir, { withFileTypes: true });
  const numbers: number[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("T")) {
      continue;
    }
    const match = /^T(\d{3})_/.exec(entry.name);
    if (match) {
      numbers.push(Number(match[1]));
    }
  }
  if (!numbers.length) {
    return 1;
  }
  return Math.max(...numbers) + 1;
}

function bootstrapRoadmap(goal: string): JsonMap {
  return {
    goal,
    created_at: nowIso(),
    updated_at: nowIso(),
    rounds: [
      {
        id: "R01",
        name: "Foundation",
        objective: "Define control plane contracts and artifact templates.",
        tasks: ["Create L0/L1/L2 skill boundaries", "Create TaskSpec/Checks/MCP templates"],
      },
      {
        id: "R02",
        name: "Execution Loop",
        objective: "Implement routing, task package generation, and worker bridge.",
        tasks: [
          "Implement skill router and MCP allowlist compiler",
          "Bridge worker execution via claude -p",
        ],
      },
      {
        id: "R03",
        name: "Hardening",
        objective: "Add validation, guardrails, and repeatable workflow docs.",
        tasks: ["Add verification checklist and runbook", "Add examples and iteration policy"],
      },
    ],
  };
}

function roadmapMd(state: JsonMap): string {
  const lines: string[] = [
    "# Roadmap",
    "",
    `- Goal: ${String(state.goal ?? "")}`,
    `- Created: ${String(state.created_at ?? "")}`,
    `- Updated: ${String(state.updated_at ?? "")}`,
    "",
  ];
  const rounds = Array.isArray(state.rounds) ? state.rounds : [];
  for (const round of rounds) {
    if (!round || typeof round !== "object") {
      continue;
    }
    const rnd = round as JsonMap;
    lines.push(`## ${String(rnd.id ?? "")} - ${String(rnd.name ?? "")}`);
    lines.push("");
    lines.push(`- Objective: ${String(rnd.objective ?? "")}`);
    lines.push("- Tasks:");
    const tasks = Array.isArray(rnd.tasks) ? rnd.tasks : [];
    for (const task of tasks) {
      lines.push(`  - ${String(task)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function splitCsv(input: string): string[] {
  return input
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitSemicolon(input: string): string[] {
  return input
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function listToBullet(items: string[], emptyText: string): string {
  if (!items.length) {
    return `- ${emptyText}`;
  }
  return items.map((x) => `- ${x}`).join("\n");
}

async function httpPostJson(urlStr: string, payload: JsonMap, headers: Record<string, string>, timeoutSec: number): Promise<HttpResult> {
  const url = new URL(urlStr);
  const body = Buffer.from(JSON.stringify(payload), "utf-8");
  const lib = url.protocol === "http:" ? http : https;

  return new Promise<HttpResult>((resolve) => {
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(body.length),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsed: JsonMap = {};
          try {
            parsed = raw ? (JSON.parse(raw) as JsonMap) : {};
          } catch {
            parsed = {};
          }
          resolve({
            status: res.statusCode || 0,
            parsed,
            raw,
          });
        });
      }
    );

    req.on("error", (error) => {
      resolve({
        status: 0,
        parsed: {},
        raw: String(error.message || error),
      });
    });

    req.setTimeout(timeoutSec * 1000, () => {
      req.destroy(new Error(`Request timed out after ${timeoutSec}s`));
    });
    req.write(body);
    req.end();
  });
}

function extractOpenAIText(resp: JsonMap): string {
  const choices = Array.isArray(resp.choices) ? resp.choices : [];
  if (!choices.length || typeof choices[0] !== "object" || !choices[0]) {
    return JSON.stringify(resp, null, 2);
  }
  const message = (choices[0] as JsonMap).message as JsonMap | undefined;
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object" && typeof (item as JsonMap).text === "string") {
        texts.push((item as JsonMap).text as string);
      }
    }
    return texts.join("\n");
  }
  return String(content ?? "");
}

function extractAnthropicText(resp: JsonMap): string {
  const content = Array.isArray(resp.content) ? resp.content : [];
  const texts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object") {
      const obj = item as JsonMap;
      if (obj.type === "text" && typeof obj.text === "string") {
        texts.push(obj.text);
      }
    }
  }
  return texts.join("\n").trim() || JSON.stringify(resp, null, 2);
}

function extractGeminiText(resp: JsonMap): string {
  const candidates = Array.isArray(resp.candidates) ? resp.candidates : [];
  if (!candidates.length || !candidates[0] || typeof candidates[0] !== "object") {
    return JSON.stringify(resp, null, 2);
  }
  const content = ((candidates[0] as JsonMap).content || {}) as JsonMap;
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const texts: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object" && typeof (part as JsonMap).text === "string") {
      texts.push((part as JsonMap).text as string);
    }
  }
  return texts.join("\n").trim() || JSON.stringify(resp, null, 2);
}

async function runProviderApi(prompt: string, flags: Flags): Promise<RunResult> {
  const provider = getFlagString(flags, "provider", "openai").toLowerCase();
  const apiKey = getFlagString(flags, "api-key", "");
  const model = getFlagString(flags, "model", "");
  const timeoutSec = Number(getFlagString(flags, "timeout-sec", "180")) || 180;
  const systemPrompt = getFlagString(flags, "system-prompt", "You are the worker model. Follow task scope strictly.");
  const temperature = Number(getFlagString(flags, "temperature", "0.2")) || 0.2;
  const maxTokens = Number(getFlagString(flags, "max-tokens", "2048")) || 2048;
  const apiUrlFlag = getFlagString(flags, "api-url", "");
  const anthropicVersion = getFlagString(flags, "anthropic-version", "2023-06-01");

  if (!model) {
    return { exitCode: 2, stdout: "", stderr: "`--model` is required for provider_api worker.", timedOut: false };
  }

  if (!["openai", "anthropic", "gemini", "custom"].includes(provider)) {
    return { exitCode: 2, stdout: "", stderr: `Unsupported provider: ${provider}`, timedOut: false };
  }

  let url = "";
  const headers: Record<string, string> = {};
  let payload: JsonMap = {};

  if (provider === "openai") {
    if (!apiKey) {
      return { exitCode: 2, stdout: "", stderr: "`--api-key` is required for openai provider.", timedOut: false };
    }
    const base = (apiUrlFlag || "https://api.openai.com/v1").replace(/\/+$/g, "");
    url = `${base}/chat/completions`;
    headers.Authorization = `Bearer ${apiKey}`;
    payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature,
    };
  } else if (provider === "anthropic") {
    if (!apiKey) {
      return { exitCode: 2, stdout: "", stderr: "`--api-key` is required for anthropic provider.", timedOut: false };
    }
    url = (apiUrlFlag || "https://api.anthropic.com/v1/messages").replace(/\/+$/g, "");
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = anthropicVersion;
    payload = {
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    };
  } else if (provider === "gemini") {
    if (apiUrlFlag) {
      url = apiUrlFlag;
      if (apiKey) {
        headers["x-goog-api-key"] = apiKey;
      }
    } else {
      if (!apiKey) {
        return {
          exitCode: 2,
          stdout: "",
          stderr: "`--api-key` is required for gemini provider when --api-url is omitted.",
          timedOut: false,
        };
      }
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    }
    payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
  } else {
    if (!apiUrlFlag) {
      return { exitCode: 2, stdout: "", stderr: "`--api-url` is required for custom provider.", timedOut: false };
    }
    url = apiUrlFlag;
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    payload = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature,
    };
  }

  const result = await httpPostJson(url, payload, headers, timeoutSec);
  if (result.status >= 400 || result.status === 0) {
    return { exitCode: result.status || 1, stdout: "", stderr: result.raw, timedOut: false };
  }

  let text = "";
  if (provider === "openai" || provider === "custom") {
    text = extractOpenAIText(result.parsed);
  } else if (provider === "anthropic") {
    text = extractAnthropicText(result.parsed);
  } else {
    text = extractGeminiText(result.parsed);
  }
  return { exitCode: 0, stdout: text, stderr: "", timedOut: false };
}

async function runSubprocess(command: string, args: string[], cwd: string, timeoutSec: number): Promise<RunResult> {
  return new Promise<RunResult>((resolve) => {
    const child = spawn(command, args, { cwd, env: process.env });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        timedOut,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: String(err.message || err),
        timedOut: false,
      });
    });
  });
}

async function cmdInit(flags: Flags): Promise<number> {
  const goal = getFlagString(flags, "goal", "");
  if (!goal) {
    console.error("Missing required flag: --goal");
    return 2;
  }
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.mkdir(ROUNDS_DIR, { recursive: true });
  await fs.mkdir(path.join(ROOT, "skills"), { recursive: true });
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
  await fs.mkdir(path.join(ROOT, "config"), { recursive: true });

  const state = bootstrapRoadmap(goal);
  await writeJson(ROADMAP_JSON, state);
  await writeText(ROADMAP_MD, roadmapMd(state));
  console.log(`Initialized roadmap at ${ROADMAP_MD}`);
  console.log(`State saved to ${ROADMAP_JSON}`);
  return 0;
}

async function cmdNewTask(flags: Flags): Promise<number> {
  if (!existsSync(CONFIG)) {
    console.error(`Missing router rules: ${CONFIG}`);
    return 2;
  }
  const title = getFlagString(flags, "title", "");
  const goal = getFlagString(flags, "goal", "");
  const scope = getFlagString(flags, "scope", "");
  if (!title || !goal || !scope) {
    console.error("Missing required flags: --title --goal --scope");
    return 2;
  }

  const rules = await readJson(CONFIG);
  const filesArg = getFlagString(flags, "files", "");
  const acceptanceArg = getFlagString(flags, "acceptance", "");
  const routeText = `${title} ${goal} ${scope} ${filesArg} ${acceptanceArg}`;
  const routed = routeTask(routeText, rules);

  const roundId = getFlagString(flags, "round", "R01").toUpperCase();
  const roundDir = path.join(ROUNDS_DIR, roundId);
  const taskNum = await detectNextTaskNum(roundDir);
  const taskId = `T${String(taskNum).padStart(3, "0")}`;
  const taskSlug = asciiSlug(title, taskId.toLowerCase());
  const taskDir = path.join(roundDir, `${taskId}_${taskSlug}`);
  await fs.mkdir(taskDir, { recursive: false });

  const specTemplate = await loadTemplate("task_spec.md.tmpl");
  const checksTemplate = await loadTemplate("checks.md.tmpl");
  const l2Template = await loadTemplate("task_skill.md.tmpl");

  const filesScope = listToBullet(splitCsv(filesArg), "(none provided)");
  const acceptanceScope = listToBullet(splitSemicolon(acceptanceArg), "(none provided)");
  const doNotTouch = listToBullet(splitCsv(getFlagString(flags, "do-not-touch", "")), "(none)");

  const spec = renderTemplate(specTemplate, {
    task_id: taskId,
    round_id: roundId,
    title,
    owner: getFlagString(flags, "owner", "worker"),
    goal,
    scope,
    files: filesScope,
    do_not_touch: doNotTouch,
    acceptance: acceptanceScope,
    rollback: getFlagString(flags, "rollback", "Revert this task folder and related patch if checks fail."),
  });
  const checks = renderTemplate(checksTemplate, {
    verify_commands: getFlagString(flags, "verify-commands", "npm test || true; npm run lint || true; npm run build || true"),
    notes: getFlagString(flags, "notes", "Add concrete command outputs before task close."),
  });
  const l2Skill = renderTemplate(l2Template, {
    task_id: taskId,
    title,
    goal,
    files: filesScope,
    do_not_touch: doNotTouch,
  });

  await writeText(path.join(taskDir, "TaskSpec.md"), spec);
  await writeText(path.join(taskDir, "Checks.md"), checks);
  await writeText(path.join(taskDir, "TASK.SKILL.md"), l2Skill);
  await writeJson(path.join(taskDir, "mcp_allowlist.json"), {
    profiles: routed.profiles,
    tools: routed.mcpTools,
    reason_keywords: routed.matchedKeywords,
  });
  await writeJson(path.join(taskDir, "route.json"), {
    l1_skills: routed.skills,
    l2_skill: path.relative(ROOT, path.join(taskDir, "TASK.SKILL.md")),
  });

  console.log(`Task created: ${taskDir}`);
  console.log("L1 skills:");
  routed.skills.forEach((s) => console.log(`- ${s}`));
  console.log("MCP tools:");
  routed.mcpTools.forEach((t) => console.log(`- ${t}`));
  return 0;
}

async function buildWorkerPrompt(taskDir: string): Promise<string> {
  const spec = await fs.readFile(path.join(taskDir, "TaskSpec.md"), "utf-8");
  const checks = await fs.readFile(path.join(taskDir, "Checks.md"), "utf-8");
  const l2 = await fs.readFile(path.join(taskDir, "TASK.SKILL.md"), "utf-8");
  return [
    "You are the worker model. Execute this task with minimal diff and strict scope.",
    "",
    "Return sections in this order:",
    "1) Plan (short)",
    "2) Proposed file changes",
    "3) Verification commands",
    "4) Risks/blockers",
    "",
    "TaskSpec:",
    spec,
    "",
    "Checks:",
    checks,
    "",
    "L2 Task Skill:",
    l2,
    "",
  ].join("\n");
}

async function cmdRunWorker(flags: Flags): Promise<number> {
  const taskDirRaw = getFlagString(flags, "task-dir", "");
  if (!taskDirRaw) {
    console.error("Missing required flag: --task-dir");
    return 2;
  }
  const taskDir = path.resolve(taskDirRaw);
  const required = ["TaskSpec.md", "Checks.md", "TASK.SKILL.md"];
  const missing = required.filter((name) => !existsSync(path.join(taskDir, name)));
  if (missing.length > 0) {
    console.error(`Task directory missing required files: ${missing.join(", ")}`);
    return 2;
  }

  const prompt = await buildWorkerPrompt(taskDir);
  await writeText(path.join(taskDir, "WORKER_PROMPT.md"), prompt);

  const worker = getFlagString(flags, "worker", "claude");
  const timeoutSec = Number(getFlagString(flags, "timeout-sec", "180")) || 180;
  let result: RunResult;

  if (worker === "provider_api") {
    result = await runProviderApi(prompt, flags);
  } else if (worker === "claude") {
    const args: string[] = [];
    if (getFlagBool(flags, "dangerous-permissions")) {
      args.push("--dangerously-skip-permissions");
    }
    args.push("-p", prompt);
    result = await runSubprocess("claude", args, ROOT, timeoutSec);
  } else if (worker === "echo") {
    result = await runSubprocess("echo", ["Worker bridge is configured. Use --worker claude to execute."], ROOT, timeoutSec);
  } else {
    console.error(`Unsupported worker: ${worker}`);
    return 2;
  }

  const output = [
    `# Worker Output (${worker})`,
    "",
    `- Exit code: ${result.exitCode}`,
    `- Timed out: ${String(result.timedOut).toLowerCase()}`,
    `- Note: ${result.timedOut ? `Timed out after ${timeoutSec} seconds.` : "None"}`,
    "",
    "## STDOUT",
    "",
    result.stdout.trim(),
    "",
    "## STDERR",
    "",
    result.stderr.trim(),
    "",
  ].join("\n");

  await writeText(path.join(taskDir, "WORKER_OUTPUT.md"), output);
  console.log(`Worker output saved to ${path.join(taskDir, "WORKER_OUTPUT.md")}`);
  return result.exitCode;
}

function printHelp(): void {
  const help = `
AIStack brain orchestrator (Node/TypeScript)

Usage:
  node dist/scripts/brain.js init --goal "<goal>"
  node dist/scripts/brain.js new-task --title "<title>" --goal "<goal>" --scope "<scope>" [options]
  node dist/scripts/brain.js run-worker --task-dir "<taskDir>" [options]

Commands:
  init
  new-task
  run-worker
`;
  process.stdout.write(help);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  const flags = parseFlags(argv.slice(1));
  if (command === "init") {
    return cmdInit(flags);
  }
  if (command === "new-task") {
    return cmdNewTask(flags);
  }
  if (command === "run-worker") {
    return cmdRunWorker(flags);
  }
  console.error(`Unknown command: ${command}`);
  printHelp();
  return 2;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(String(error));
    process.exit(1);
  });
