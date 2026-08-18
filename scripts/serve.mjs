import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { localApiPlugin } from "./local-api.mjs";

const root = resolve(process.cwd());
const publicRoot = join(root, "dist", "client");

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
  model: env.MODEL_NAME || env.DEEPSEEK_MODEL || "deepseek-v4-pro",
  baseUrl: env.MODEL_API_URL || env.DEEPSEEK_API_URL || "https://api.deepseek.com",
  timeoutMs: Number(env.MODEL_TIMEOUT_MS || 90000),
};

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

const server = createServer((req, res) => {
  if (req.url.startsWith("/api/v1")) {
    req.url = req.url.slice("/api/v1".length) || "/";
    return apiHandler(req, res, () => { res.statusCode = 404; res.end("Not found"); });
  }
  return staticResponse(req, res);
});

const requested = Number(process.env.PORT || process.argv[2] || 4180);
function listen(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < requested + 10) { server.close(); listen(port + 1); }
    else throw error;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`NTU AI Medical Agent Evaluation Platform\nhttp://127.0.0.1:${port}/\nPress Ctrl+C to stop.`);
  });
}
listen(requested);
