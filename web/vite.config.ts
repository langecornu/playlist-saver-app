import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server");
const DEFAULT_PORT = 8000;

// The API port is a saved setting (Settings > Advanced), so read it from the same file the API uses.
function configuredPort(): number {
  try {
    const home = process.env.PLAYLIST_SAVER_HOME || path.join(os.homedir(), ".config", "playlist-saver");
    const port = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"))?.settings?.port;
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

// Port of the API that is (or is about to be) running. It only changes when a new API process is
// started, so saving a new port never makes the still-running one look offline.
let apiPort = configuredPort();

async function apiUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/defaults`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

// Forwards /api to the API on whatever port it currently uses. Streams, so server-sent events work.
function forwardApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const upstream = http.request(
    { host: "127.0.0.1", port: apiPort, path: "/api" + (req.url ?? ""), method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "API server is not reachable" }));
  });
  res.on("close", () => upstream.destroy());
  req.pipe(upstream);
}

// The interpreter for the API: PYTHON if set, else the project's own .venv (what the install guide
// creates, and the only place spotDL lives on a Homebrew Python), else whatever python3 is on PATH.
// Checking for the folder means nobody has to "activate" anything, so the Desktop shortcut works too.
function pythonCommand(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  const root = path.resolve(serverDir, "..");
  for (const rel of [".venv/bin/python", ".venv/Scripts/python.exe"]) {
    const candidate = path.join(root, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "python3";
}

// Starts the FastAPI server alongside `npm run dev`, and lets the UI restart it
// (POST /__api/start) if it ever goes down. Set PYTHON to use a specific interpreter.
function apiLauncher(): Plugin {
  let child: ChildProcess | null = null;
  let spawnedAt = 0;
  const STARTUP_GRACE_MS = 8000;

  async function ensure(): Promise<"running" | "starting"> {
    if (await apiUp()) return "running";
    if (child && child.exitCode === null) {
      // Still booting: give it a moment. A child that never answers is stuck (e.g. it
      // lost a race for the port), so kill it and start a fresh one below.
      if (Date.now() - spawnedAt < STARTUP_GRACE_MS) return "starting";
      child.kill("SIGKILL");
    }
    apiPort = configuredPort(); // pick up a port changed in Settings
    const proc = spawn(pythonCommand(), ["-m", "uvicorn", "main:app", "--port", String(apiPort)], {
      cwd: serverDir,
      stdio: "inherit",
      env: { ...process.env, PLAYLIST_SAVER_API_PORT: String(apiPort), PLAYLIST_SAVER_MANAGED: "1" },
    });
    child = proc;
    spawnedAt = Date.now();
    proc.on("exit", () => {
      if (child === proc) child = null;
    });
    return "starting";
  }

  return {
    name: "api-launcher",
    configureServer(server) {
      void ensure();
      server.middlewares.use("/api", forwardApi);
      server.middlewares.use("/__api/start", async (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ status: await ensure() }));
      });
      const stop = () => child?.kill();
      server.httpServer?.on("close", stop);
      process.on("exit", stop);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api", forwardApi);
    },
  };
}

export default defineConfig({
  plugins: [react(), apiLauncher()],
  server: { port: 5173 },
});
