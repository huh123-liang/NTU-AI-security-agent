import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { localApiPlugin } from "./local-api.mjs";

const root = resolve(process.cwd());
const publicRoot = join(root, "dist", "client");
const runtimeDir = join(root, ".runtime");
const instanceFile = join(runtimeDir, "platform-instance.json");
const pidFile = join(runtimeDir, "platform.pid");
const portFile = join(runtimeDir, "platform.port");
const instanceId = randomUUID();
const startedAt = new Date().toISOString();
const runtimeInfo = {
  instanceId,
  processId: process.pid,
  projectRoot: root,
  startedAt,
  modelConnectivity: { status: "checking", checkedAt: null },
};

function localEnv() {
  const values = {};
  for (const file of [".env.local", ".env"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1].startsWith("#")) continue;
      values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
  return { ...values, ...process.env };
}

const env = localEnv();
const modelConfig = {
  provider: env.MODEL_PROVIDER || env.MEDICAL_MODEL_PROVIDER || "deepseek",
  apiKey: env.MODEL_API_KEY || env.DEEPSEEK_API_KEY,
  model: env.MODEL_NAME || env.DEEPSEEK_MODEL || "deepseek-chat",
  baseUrl: env.MODEL_API_URL || env.DEEPSEEK_API_URL || "https://api.deepseek.com",
  timeoutMs: Number(env.MODEL_TIMEOUT_MS || 90000),
  maxAttempts: Number(env.MODEL_MAX_ATTEMPTS || 3),
  retryDelayMs: Number(env.MODEL_RETRY_DELAY_MS || 800),
  runtime: runtimeInfo,
};

function checkProviderHttps(baseUrl) {
  return new Promise((resolveConnectivity) => {
    let target;
    try { target = new URL(baseUrl); }
    catch { resolveConnectivity({ status: "invalid_url", checkedAt: new Date().toISOString() }); return; }
    const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    const socket = connect({ host: target.hostname, port });
    let settled = false;
    const finish = (status, code = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveConnectivity({ status, host: target.hostname, port, code, checkedAt: new Date().toISOString() });
    };
    socket.setTimeout(8000);
    socket.once("connect", () => finish("reachable"));
    socket.once("timeout", () => finish("blocked", "TIMEOUT"));
    socket.once("error", (error) => finish("blocked", error.code || "NETWORK_ERROR"));
  });
}

let apiHandler;
localApiPlugin(root, modelConfig).configureServer({ middlewares: { use(prefix, handler) { if (prefix === "/api/v1") apiHandler = handler; } } });

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2" };

function staticResponse(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const candidate = normalize(join(publicRoot, pathname === "/" ? "index.html" : pathname));
  const safe = candidate.startsWith(publicRoot) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(publicRoot, "index.html");
  res.statusCode = 200;
  res.setHeader("content-type", mime[extname(safe).toLowerCase()] || "application/octet-stream");
  res.setHeader("cache-control", safe.endsWith("index.html") ? "no-cache" : "public, max-age=3600");
  createReadStream(safe).pipe(res);
}

if (!existsSync(join(publicRoot, "index.html"))) throw new Error("Production files are missing. Run npm run build first.");

function createPlatformServer() {
  return createServer((req, res) => {
    if (req.url.startsWith("/api/v1")) {
      req.url = req.url.slice("/api/v1".length) || "/";
      return apiHandler(req, res, () => { res.statusCode = 404; res.end("Not found"); });
    }
    return staticResponse(req, res);
  });
}

function writeRuntimeIdentity(port) {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(instanceFile, JSON.stringify({ instanceId, processId: process.pid, port, projectRoot: root, startedAt }, null, 2), "utf8");
  writeFileSync(pidFile, String(process.pid), "ascii");
  writeFileSync(portFile, String(port), "ascii");
}

function removeRuntimeIdentity() {
  try {
    const current = JSON.parse(readFileSync(instanceFile, "utf8"));
    if (current.instanceId !== instanceId) return;
    for (const file of [instanceFile, pidFile, portFile]) rmSync(file, { force: true });
  } catch { /* another instance owns the runtime record, or it is already gone */ }
}

const requested = Number(process.env.PORT || process.argv[2] || 4180);
let activeServer = null;
function listen(port) {
  const server = createPlatformServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < requested + 9) {
      server.close();
      listen(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, "127.0.0.1", () => {
    activeServer = server;
    writeRuntimeIdentity(port);
    checkProviderHttps(modelConfig.baseUrl).then((result) => { runtimeInfo.modelConnectivity = result; });
    console.log(`NTU AI Medical Agent Evaluation Platform\nhttp://127.0.0.1:${port}/\nPress Ctrl+C to stop.`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    removeRuntimeIdentity();
    if (activeServer) activeServer.close(() => process.exit(0));
    else process.exit(0);
  });
}
process.once("exit", removeRuntimeIdentity);
listen(requested);
