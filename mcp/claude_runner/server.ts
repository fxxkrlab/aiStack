#!/usr/bin/env node
import { existsSync } from "fs";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as path from "path";
import { spawn } from "child_process";

type Json = Record<string, unknown>;
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const SERVER_NAME = "claude-runner";
const SERVER_VERSION = "0.2.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT_SEC = 180;
const DEFAULT_MAX_FILE_CHARS = 6000;

function writeMessage(data: Json): void {
  const body = Buffer.from(JSON.stringify(data), "utf-8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  process.stdout.write(header);
  process.stdout.write(body);
}

function readSyncRetry(buffer: Buffer, offset: number, length: number): number {
  while (true) {
    try {
      return fs.readSync(process.stdin.fd, buffer, offset, length, null);
    } catch (err) {
      if (err && typeof err === "object") {
        const code = (err as { code?: string }).code;
        if (code === "EAGAIN" || code === "EINTR") {
          continue;
        }
      }
      throw err;
    }
  }
}

function readExactSync(total: number): Buffer | null {
  const out = Buffer.alloc(total);
  let offset = 0;
  while (offset < total) {
    const size = readSyncRetry(out, offset, total - offset);
    if (size <= 0) {
      return null;
    }
    offset += size;
  }
  return out;
}

function readMessageSync(): Json | null {
  let headerRaw = "";
  while (true) {
    const one = Buffer.alloc(1);
    const n = readSyncRetry(one, 0, 1);
    if (n <= 0) {
      return null;
    }
    headerRaw += one.toString("ascii");
    if (headerRaw.endsWith("\r\n\r\n")) {
      break;
    }
  }
  const lines = headerRaw.split("\r\n").filter(Boolean);
  const headerMap: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim().toLowerCase();
      const value = line.slice(idx + 1).trim();
      headerMap[key] = value;
    }
  }
  const len = Number(headerMap["content-length"] || "0");
  if (!len) {
    return null;
  }
  const body = readExactSync(len);
  if (!body) {
    return null;
  }
  return JSON.parse(body.toString("utf-8")) as Json;
}

function successResponse(id: unknown, result: unknown): Json {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: unknown, code: number, message: string, data?: unknown): Json {
  const err: Json = { code, message };
  if (data !== undefined) {
    err.data = data;
  }
  return { jsonrpc: "2.0", id, error: err };
}

function notification(method: string, params?: unknown): Json {
  const out: Json = { jsonrpc: "2.0", method };
  if (params !== undefined) {
    out.params = params;
  }
  return out;
}

function parseAllowedRoots(): string[] {
  const raw = (process.env.CLAUDE_RUNNER_ALLOWED_ROOTS || "").trim();
  const roots = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => path.resolve(x));
  if (roots.length) {
    return roots;
  }
  return [path.resolve(process.cwd())];
}

function isUnder(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function validateCwd(rawCwd: string | undefined, roots: string[]): { ok: true; cwd: string } | { ok: false; error: string } {
  const cwd = path.resolve(rawCwd || process.cwd());
  if (roots.some((root) => isUnder(root, cwd))) {
    return { ok: true, cwd };
  }
  return { ok: false, error: `cwd '${cwd}' is outside allowed roots: ${roots.join(", ")}` };
}

async function appendFilesContext(prompt: string, cwd: string, files: string[], maxChars: number): Promise<string> {
  if (!files.length) {
    return prompt;
  }
  const chunks: string[] = [prompt, "", "Context files:"];
  for (const rel of files) {
    const full = path.resolve(cwd, rel);
    if (!existsSync(full)) {
      chunks.push(`\n[FILE: ${rel}]`);
      chunks.push("(missing)");
      continue;
    }
    const content = await fsp.readFile(full, "utf-8").catch(() => "(read failed)");
    chunks.push(`\n[FILE: ${rel}]`);
    chunks.push(content.slice(0, maxChars));
  }
  return chunks.join("\n");
}

async function runClaude(prompt: string, cwd: string, timeoutSec: number): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", prompt], { cwd, env: process.env });
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
      resolve({ exitCode: 1, stdout: "", stderr: String(err.message || err), timedOut: false });
    });
  });
}

function formatRun(worker: { exitCode: number; stdout: string; stderr: string; timedOut: boolean }, cwd: string): string {
  return [
    "# Claude Runner Result",
    "",
    `- exit_code: ${worker.exitCode}`,
    `- timed_out: ${String(worker.timedOut).toLowerCase()}`,
    `- cwd: ${cwd}`,
    "- command: claude -p <prompt>",
    "",
    "## stdout",
    "",
    worker.stdout.trim(),
    "",
    "## stderr",
    "",
    worker.stderr.trim(),
    "",
  ].join("\n");
}

const TOOLS: Json[] = [
  {
    name: "claude.one_shot",
    description: "Run a one-shot prompt with `claude -p` and return stdout/stderr metadata.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        cwd: { type: "string" },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
        context_files: { type: "array", items: { type: "string" } },
        max_file_chars: { type: "integer", minimum: 100, maximum: 50000 },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "claude.review_diff",
    description: "Review a unified diff and report findings by severity.",
    inputSchema: {
      type: "object",
      properties: {
        diff: { type: "string" },
        cwd: { type: "string" },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
      },
      required: ["diff"],
      additionalProperties: false,
    },
  },
  {
    name: "claude.generate_patch",
    description: "Generate a unified diff patch from context and instructions.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        context: { type: "string" },
        cwd: { type: "string" },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
      },
      required: ["task", "context"],
      additionalProperties: false,
    },
  },
];

async function callTool(name: string, argumentsObj: Json, roots: string[]): Promise<ToolResult> {
  const validation = validateCwd(typeof argumentsObj.cwd === "string" ? argumentsObj.cwd : undefined, roots);
  if (!validation.ok) {
    return { content: [{ type: "text", text: validation.error }], isError: true };
  }
  const cwd = validation.cwd;
  const timeoutSec = Number(argumentsObj.timeout_sec || DEFAULT_TIMEOUT_SEC);

  if (name === "claude.one_shot") {
    const prompt = String(argumentsObj.prompt || "").trim();
    if (!prompt) {
      return { content: [{ type: "text", text: "`prompt` is required." }], isError: true };
    }
    const files = Array.isArray(argumentsObj.context_files) ? argumentsObj.context_files.map((x) => String(x)) : [];
    const maxFileChars = Number(argumentsObj.max_file_chars || DEFAULT_MAX_FILE_CHARS);
    const fullPrompt = await appendFilesContext(prompt, cwd, files, maxFileChars);
    const run = await runClaude(fullPrompt, cwd, timeoutSec);
    return {
      content: [{ type: "text", text: formatRun(run, cwd) }],
      isError: run.exitCode !== 0,
    };
  }

  if (name === "claude.review_diff") {
    const diff = String(argumentsObj.diff || "").trim();
    if (!diff) {
      return { content: [{ type: "text", text: "`diff` is required." }], isError: true };
    }
    const prompt = [
      "You are a strict code reviewer.",
      "Review the diff and output:",
      "1) Findings ordered by severity",
      "2) Open questions",
      "3) Regression risks",
      "",
      "Diff:",
      diff,
      "",
    ].join("\n");
    const run = await runClaude(prompt, cwd, timeoutSec);
    return {
      content: [{ type: "text", text: formatRun(run, cwd) }],
      isError: run.exitCode !== 0,
    };
  }

  if (name === "claude.generate_patch") {
    const task = String(argumentsObj.task || "").trim();
    const context = String(argumentsObj.context || "").trim();
    if (!task || !context) {
      return { content: [{ type: "text", text: "`task` and `context` are required." }], isError: true };
    }
    const prompt = [
      "Generate a unified diff patch only.",
      "No markdown fences, no prose.",
      "",
      "Task:",
      task,
      "",
      "Context:",
      context,
      "",
    ].join("\n");
    const run = await runClaude(prompt, cwd, timeoutSec);
    return {
      content: [{ type: "text", text: formatRun(run, cwd) }],
      isError: run.exitCode !== 0,
    };
  }

  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
}

async function handleRequest(msg: Json, roots: string[]): Promise<Json | null> {
  const method = String(msg.method || "");
  const id = msg.id;
  const params = (msg.params as Json) || {};

  if (method === "initialize") {
    return successResponse(id, {
      protocolVersion: params.protocolVersion || DEFAULT_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  if (method === "tools/list") {
    return successResponse(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const name = String(params.name || "");
    const argumentsObj = ((params.arguments as Json) || {}) as Json;
    if (!name) {
      return errorResponse(id, -32602, "Invalid params: missing tool name.");
    }
    const result = await callTool(name, argumentsObj, roots);
    return successResponse(id, result);
  }

  if (method === "ping") {
    return successResponse(id, {});
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }
  if (id !== undefined) {
    return errorResponse(id, -32601, `Method not found: ${method}`);
  }
  return null;
}

async function main(): Promise<void> {
  const roots = parseAllowedRoots();
  writeMessage(notification("server/ready", { name: SERVER_NAME, version: SERVER_VERSION }));
  while (true) {
    const msg = readMessageSync();
    if (!msg) {
      return;
    }
    try {
      const response = await handleRequest(msg, roots);
      if (response) {
        writeMessage(response);
      }
    } catch (err) {
      if (msg.id !== undefined) {
        writeMessage(errorResponse(msg.id, -32000, String(err), { stack: err instanceof Error ? err.stack : undefined }));
      }
    }
  }
}

main().catch((err) => {
  writeMessage(errorResponse(null, -32000, String(err)));
});
