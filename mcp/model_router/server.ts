#!/usr/bin/env node
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import { URL } from "url";

type Json = Record<string, unknown>;
type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const SERVER_NAME = "model-router";
const SERVER_VERSION = "0.2.0";
const DEFAULT_PROTOCOL_VERSION = "2024-11-05";

type ModelSpec = {
  id: string;
  provider: "openai" | "anthropic" | "gemini" | "custom";
  model: string;
  api_url: string;
  api_key: string;
  system_prompt: string;
};

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
      headerMap[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
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

async function httpPostJson(urlStr: string, payload: Json, headers: Record<string, string>, timeoutSec: number): Promise<{ status: number; parsed: Json; raw: string }> {
  const url = new URL(urlStr);
  const body = Buffer.from(JSON.stringify(payload), "utf-8");
  const lib = url.protocol === "http:" ? http : https;

  return new Promise((resolve) => {
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
          let parsed: Json = {};
          try {
            parsed = raw ? (JSON.parse(raw) as Json) : {};
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
    req.on("error", (err) => {
      resolve({ status: 0, parsed: {}, raw: String(err.message || err) });
    });
    req.setTimeout(timeoutSec * 1000, () => {
      req.destroy(new Error(`Request timed out after ${timeoutSec}s`));
    });
    req.write(body);
    req.end();
  });
}

function extractOpenAIText(resp: Json): string {
  const choices = Array.isArray(resp.choices) ? resp.choices : [];
  if (!choices.length || typeof choices[0] !== "object" || !choices[0]) {
    return JSON.stringify(resp, null, 2);
  }
  const message = (choices[0] as Json).message as Json | undefined;
  const content = message?.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const item of content) {
      if (item && typeof item === "object" && typeof (item as Json).text === "string") {
        chunks.push((item as Json).text as string);
      }
    }
    return chunks.join("\n");
  }
  return String(content ?? "");
}

function extractAnthropicText(resp: Json): string {
  const content = Array.isArray(resp.content) ? resp.content : [];
  const chunks: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object") {
      const row = item as Json;
      if (row.type === "text" && typeof row.text === "string") {
        chunks.push(row.text);
      }
    }
  }
  return chunks.join("\n").trim() || JSON.stringify(resp, null, 2);
}

function extractGeminiText(resp: Json): string {
  const candidates = Array.isArray(resp.candidates) ? resp.candidates : [];
  if (!candidates.length || !candidates[0] || typeof candidates[0] !== "object") {
    return JSON.stringify(resp, null, 2);
  }
  const content = ((candidates[0] as Json).content || {}) as Json;
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const chunks: string[] = [];
  for (const part of parts) {
    if (part && typeof part === "object" && typeof (part as Json).text === "string") {
      chunks.push((part as Json).text as string);
    }
  }
  return chunks.join("\n").trim() || JSON.stringify(resp, null, 2);
}

function toModelSpec(input: unknown, fallbackId: string): ModelSpec | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const obj = input as Json;
  const provider = String(obj.provider || "").toLowerCase() as ModelSpec["provider"];
  const model = String(obj.model || "").trim();
  if (!provider || !model) {
    return null;
  }
  return {
    id: String(obj.id || fallbackId),
    provider,
    model,
    api_url: String(obj.api_url || ""),
    api_key: String(obj.api_key || ""),
    system_prompt: String(obj.system_prompt || ""),
  };
}

async function callModel(spec: ModelSpec, prompt: string, timeoutSec: number, temperature: number, maxTokens: number): Promise<{ code: number; text: string }> {
  const headers: Record<string, string> = {};
  let url = "";
  let payload: Json = {};

  if (spec.provider === "openai") {
    if (!spec.api_key) {
      return { code: 2, text: `[${spec.id}] missing api_key for openai.` };
    }
    const base = (spec.api_url || "https://api.openai.com/v1").replace(/\/+$/g, "");
    url = `${base}/chat/completions`;
    headers.Authorization = `Bearer ${spec.api_key}`;
    payload = {
      model: spec.model,
      messages: [
        { role: "system", content: spec.system_prompt || "You are a helpful assistant." },
        { role: "user", content: prompt },
      ],
      temperature,
    };
  } else if (spec.provider === "anthropic") {
    if (!spec.api_key) {
      return { code: 2, text: `[${spec.id}] missing api_key for anthropic.` };
    }
    url = (spec.api_url || "https://api.anthropic.com/v1/messages").replace(/\/+$/g, "");
    headers["x-api-key"] = spec.api_key;
    headers["anthropic-version"] = "2023-06-01";
    payload = {
      model: spec.model,
      system: spec.system_prompt || "You are a helpful assistant.",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
  } else if (spec.provider === "gemini") {
    if (spec.api_url) {
      url = spec.api_url;
      if (spec.api_key) {
        headers["x-goog-api-key"] = spec.api_key;
      }
    } else {
      if (!spec.api_key) {
        return { code: 2, text: `[${spec.id}] missing api_key for gemini.` };
      }
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(spec.model)}:generateContent?key=${encodeURIComponent(spec.api_key)}`;
    }
    payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: spec.system_prompt || "You are a helpful assistant." }] },
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    };
  } else if (spec.provider === "custom") {
    if (!spec.api_url) {
      return { code: 2, text: `[${spec.id}] missing api_url for custom provider.` };
    }
    url = spec.api_url;
    if (spec.api_key) {
      headers.Authorization = `Bearer ${spec.api_key}`;
    }
    payload = {
      model: spec.model,
      messages: [
        { role: "system", content: spec.system_prompt || "You are a helpful assistant." },
        { role: "user", content: prompt },
      ],
      temperature,
    };
  } else {
    return { code: 2, text: `[${spec.id}] unsupported provider: ${spec.provider}` };
  }

  const result = await httpPostJson(url, payload, headers, timeoutSec);
  if (result.status >= 400 || result.status === 0) {
    return { code: result.status || 1, text: result.raw };
  }
  if (spec.provider === "openai" || spec.provider === "custom") {
    return { code: 0, text: extractOpenAIText(result.parsed) };
  }
  if (spec.provider === "anthropic") {
    return { code: 0, text: extractAnthropicText(result.parsed) };
  }
  return { code: 0, text: extractGeminiText(result.parsed) };
}

async function runBrainstorm(argumentsObj: Json): Promise<ToolResult> {
  const requirement = String(argumentsObj.requirement || "").trim();
  if (!requirement) {
    return { content: [{ type: "text", text: "`requirement` is required." }], isError: true };
  }
  const rawParticipants = Array.isArray(argumentsObj.participants) ? argumentsObj.participants : [];
  const participants: ModelSpec[] = [];
  rawParticipants.forEach((item, idx) => {
    const spec = toModelSpec(item, `model_${idx + 1}`);
    if (spec) {
      participants.push(spec);
    }
  });
  if (!participants.length) {
    return { content: [{ type: "text", text: "`participants` must include at least one valid model." }], isError: true };
  }

  const debateRounds = Math.max(0, Math.min(5, Number(argumentsObj.debate_rounds || 1)));
  const synthesisBy = String(argumentsObj.synthesis_by || participants[0].id);
  const timeoutSec = Number(argumentsObj.timeout_sec || 180);
  const temperature = Number(argumentsObj.temperature || 0.2);
  const maxTokens = Number(argumentsObj.max_tokens || 2048);

  const proposals: Record<string, string> = {};
  const errors: string[] = [];

  for (const model of participants) {
    const prompt = [
      "You are participating in a multi-model architecture brainstorm.",
      "Provide a concise solution proposal for the requirement.",
      "Cover: stack choices, architecture, risks, and rollout steps.",
      "",
      "Requirement:",
      requirement,
      "",
    ].join("\n");
    const call = await callModel(model, prompt, timeoutSec, temperature, maxTokens);
    if (call.code !== 0) {
      errors.push(`[proposal:${model.id}] code=${call.code}`);
      proposals[model.id] = `(failed) ${call.text}`;
    } else {
      proposals[model.id] = call.text.trim();
    }
  }

  const debates: Array<{ round: number; responses: Record<string, string> }> = [];
  let latestInputs: Record<string, string> = { ...proposals };
  for (let i = 1; i <= debateRounds; i += 1) {
    const responses: Record<string, string> = {};
    for (const model of participants) {
      const others: Record<string, string> = {};
      for (const [k, v] of Object.entries(latestInputs)) {
        if (k !== model.id) {
          others[k] = v;
        }
      }
      const prompt = [
        "You are in a technical debate. Critique the other proposals only.",
        "Output must include: strongest point, weakest assumption, missing risk, better alternative.",
        "",
        "Requirement:",
        requirement,
        "",
        "Other proposals:",
        JSON.stringify(others, null, 2),
        "",
      ].join("\n");
      const call = await callModel(model, prompt, timeoutSec, temperature, maxTokens);
      if (call.code !== 0) {
        errors.push(`[debate-r${i}:${model.id}] code=${call.code}`);
        responses[model.id] = `(failed) ${call.text}`;
      } else {
        responses[model.id] = call.text.trim();
      }
    }
    debates.push({ round: i, responses });
    latestInputs = responses;
  }

  const synthModel = participants.find((m) => m.id === synthesisBy) || participants[0];
  const synthPrompt = [
    "You are the synthesizer. Produce final architecture decision and roadmap.",
    "Output sections:",
    "1) Decision summary",
    "2) Tradeoffs",
    "3) Roadmap rounds",
    "4) Task decomposition strategy",
    "5) Validation and acceptance policy",
    "",
    "Requirement:",
    requirement,
    "",
    "Proposals:",
    JSON.stringify(proposals, null, 2),
    "",
    "Debate history:",
    JSON.stringify(debates, null, 2),
    "",
  ].join("\n");
  const synth = await callModel(synthModel, synthPrompt, timeoutSec, temperature, maxTokens);
  if (synth.code !== 0) {
    errors.push(`[synthesis:${synthModel.id}] code=${synth.code}`);
  }

  const result = {
    requirement,
    participants: participants.map((p) => p.id),
    debate_rounds: debateRounds,
    synthesis_by: synthModel.id,
    proposals,
    debates,
    synthesis: synth.text,
    errors,
  };

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: errors.length > 0,
  };
}

const TOOLS: Json[] = [
  {
    name: "model.one_shot",
    description: "Run one prompt against a selected provider/model.",
    inputSchema: {
      type: "object",
      properties: {
        model: {
          type: "object",
          properties: {
            id: { type: "string" },
            provider: { type: "string", enum: ["openai", "anthropic", "gemini", "custom"] },
            model: { type: "string" },
            api_url: { type: "string" },
            api_key: { type: "string" },
            system_prompt: { type: "string" },
          },
          required: ["provider", "model"],
          additionalProperties: false,
        },
        prompt: { type: "string" },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
        temperature: { type: "number" },
        max_tokens: { type: "integer", minimum: 1, maximum: 8192 },
      },
      required: ["model", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "model.brainstorm",
    description: "Run multi-model brainstorm + debate rounds + synthesis model selection.",
    inputSchema: {
      type: "object",
      properties: {
        requirement: { type: "string" },
        participants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              provider: { type: "string", enum: ["openai", "anthropic", "gemini", "custom"] },
              model: { type: "string" },
              api_url: { type: "string" },
              api_key: { type: "string" },
              system_prompt: { type: "string" },
            },
            required: ["id", "provider", "model"],
            additionalProperties: false,
          },
        },
        debate_rounds: { type: "integer", minimum: 0, maximum: 5 },
        synthesis_by: { type: "string" },
        timeout_sec: { type: "integer", minimum: 1, maximum: 3600 },
        temperature: { type: "number" },
        max_tokens: { type: "integer", minimum: 1, maximum: 8192 },
      },
      required: ["requirement", "participants"],
      additionalProperties: false,
    },
  },
];

async function callTool(name: string, argumentsObj: Json): Promise<ToolResult> {
  if (name === "model.one_shot") {
    const spec = toModelSpec(argumentsObj.model, "model_1");
    const prompt = String(argumentsObj.prompt || "").trim();
    if (!spec || !prompt) {
      return { content: [{ type: "text", text: "Invalid model or missing `prompt`." }], isError: true };
    }
    const timeoutSec = Number(argumentsObj.timeout_sec || 180);
    const temperature = Number(argumentsObj.temperature || 0.2);
    const maxTokens = Number(argumentsObj.max_tokens || 2048);
    const call = await callModel(spec, prompt, timeoutSec, temperature, maxTokens);
    return {
      content: [{ type: "text", text: call.text }],
      isError: call.code !== 0,
    };
  }
  if (name === "model.brainstorm") {
    return runBrainstorm(argumentsObj);
  }
  return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
}

async function handleRequest(msg: Json): Promise<Json | null> {
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
    if (!name) {
      return errorResponse(id, -32602, "Invalid params: missing tool name.");
    }
    const argumentsObj = ((params.arguments as Json) || {}) as Json;
    const result = await callTool(name, argumentsObj);
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
  writeMessage(notification("server/ready", { name: SERVER_NAME, version: SERVER_VERSION }));
  while (true) {
    const msg = readMessageSync();
    if (!msg) {
      return;
    }
    try {
      const response = await handleRequest(msg);
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
