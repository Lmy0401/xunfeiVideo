const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pinyin } = require("pinyin-pro");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADB_PATH = process.env.ADB_PATH || "D:\\Develop\\platform-tools\\adb.exe";
const PLAYBACK_SCRIPT = path.join(ROOT, "tools", "ime-tap-playback.ps1");
const PORT = Number(process.env.PORT || 5177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: ROOT,
      windowsHide: true,
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on("close", code => {
      resolve({ code, stdout, stderr });
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function textToKeys(text) {
  return pinyin(text || "", {
    toneType: "none",
    type: "array"
  }).join("").toLowerCase().replace(/[^a-z]/g, "");
}

async function sendAppScript(scriptObject) {
  const script = JSON.stringify(scriptObject);
  const scriptBase64 = Buffer.from(script, "utf8").toString("base64");
  return runCommand(ADB_PATH, ["shell", "am", "start", "-n", "com.xunfei.video.showcase/.MainActivity", "--es", "scriptBase64", scriptBase64]);
}

async function runPlayback({ text, keys, layout, delayMs, commitDelayMs, startDelayMs, visualCandidateIndex, finalSource, ensureIme, sendAfterCommit }) {
  const candidateIndex = Number(visualCandidateIndex || 0);
  const keyOnly = finalSource === "none";
  const useCandidateText = finalSource === "candidate";
  if (useCandidateText && candidateIndex <= 0) {
    return { code: 1, stdout: "", stderr: "finalSource=candidate requires visualCandidateIndex > 0", mode: "invalid" };
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", PLAYBACK_SCRIPT,
    "-AdbPath", ADB_PATH,
    "-Layout", layout,
    "-Keys", keys,
    "-DelayMs", String(delayMs),
    "-StartDelayMs", String(startDelayMs || 450)
  ];

  if (candidateIndex > 0) {
    args.push("-CandidateIndex", String(candidateIndex));
  }

  if (keyOnly) {
    // Key playback only. Used for effects such as backspace, symbol, space, or cursor demos.
  } else if (useCandidateText) {
    if (sendAfterCommit !== false) {
      args.push("-SendAfterCommit");
    }
  } else {
    args.push("-CommitText", text, "-CommitDelayMs", String(commitDelayMs));
    if (sendAfterCommit !== false) {
      args.push("-SendAfterCommit");
    }
  }

  if (ensureIme === false) {
    args.push("-SkipEnsureIme");
  }

  const result = await runCommand("powershell", args);
  return { ...result, mode: useCandidateText ? "candidate" : "commitText" };
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/devices") {
    const result = await runCommand(ADB_PATH, ["devices"]);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "GET" && req.url === "/api/ime") {
    const result = await runCommand(ADB_PATH, ["shell", "dumpsys", "input_method"]);
    const shown = /mInputShown=true|inputShown=true|imeVisible=true/.test(result.stdout);
    sendJson(res, result.code === 0 ? 200 : 500, { ...result, shown });
    return;
  }

  if (req.method === "POST" && req.url === "/api/pinyin") {
    const body = await readJson(req);
    sendJson(res, 200, { keys: textToKeys(body.text || "") });
    return;
  }

  if (req.method === "POST" && req.url === "/api/run") {
    const body = await readJson(req);
    const text = String(body.text || "").trim();
    const keys = String(body.keys || textToKeys(text)).trim().toLowerCase().replace(/[^a-z]/g, "");
    const layout = body.layout === "nine" ? "nine" : "qwerty";
    const delayMs = Number(body.delayMs || 120);
    const commitDelayMs = Number(body.commitDelayMs || 220);
    const startDelayMs = Number(body.startDelayMs || 450);
    const visualCandidateIndex = Number(body.visualCandidateIndex ?? body.candidateIndex ?? 0);
    const finalSource = body.finalSource === "candidate" ? "candidate" : "commit";

    if (!text) {
      sendJson(res, 400, { code: 1, stderr: "text is required" });
      return;
    }
    if (!keys) {
      sendJson(res, 400, { code: 1, stderr: "keys could not be generated" });
      return;
    }

    const result = await runPlayback({
      text,
      keys,
      layout,
      delayMs,
      commitDelayMs,
      startDelayMs,
      visualCandidateIndex,
      finalSource,
      ensureIme: body.ensureIme,
      sendAfterCommit: body.sendAfterCommit
    });
    sendJson(res, result.code === 0 ? 200 : 500, { ...result, keys });
    return;
  }

  if (req.method === "POST" && req.url === "/api/run-sequence") {
    const body = await readJson(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const layout = body.layout === "nine" ? "nine" : "qwerty";
    const delayMs = Number(body.delayMs || 120);
    const commitDelayMs = Number(body.commitDelayMs || 220);
    const startDelayMs = Number(body.startDelayMs || 450);
    const gapMs = Number(body.gapMs || 650);
    const visualCandidateIndex = Number(body.visualCandidateIndex ?? body.candidateIndex ?? 0);
    const finalSource = body.finalSource === "candidate" ? "candidate" : "commit";
    const logs = [];

    if (!messages.length) {
      sendJson(res, 400, { code: 1, stderr: "messages are required" });
      return;
    }

    for (let i = 0; i < messages.length; i++) {
      const item = messages[i];
      const side = item.side === "other" ? "other" : item.side === "keys" ? "keys" : "mine";
      const text = String(item.text || "").trim();
      if (!text) continue;

      logs.push(`${i + 1}. ${side === "other" ? "对方" : side === "keys" ? "按键" : "我方"}: ${text}`);

      if (side === "other") {
        const result = await sendAppScript({
          actions: [
            { type: "message", side: "other", text },
            { type: "wait", duration: gapMs }
          ]
        });
        if (result.code !== 0) {
          sendJson(res, 500, { ...result, logs });
          return;
        }
        await sleep(gapMs);
      } else if (side === "keys") {
        const result = await runPlayback({
          text: "",
          keys: text,
          layout,
          delayMs,
          commitDelayMs,
          startDelayMs,
          visualCandidateIndex: 0,
          finalSource: "none",
          ensureIme: body.ensureIme,
          sendAfterCommit: false
        });
        if (result.code !== 0) {
          sendJson(res, 500, { ...result, logs });
          return;
        }
        await sleep(gapMs);
      } else {
        const keys = String(item.keys || textToKeys(text)).toLowerCase().replace(/[^a-z]/g, "");
        if (!keys) {
          sendJson(res, 400, { code: 1, stderr: `message ${i + 1} keys could not be generated`, logs });
          return;
        }
        const result = await runPlayback({
          text,
          keys,
          layout,
          delayMs,
          commitDelayMs,
          startDelayMs,
          visualCandidateIndex,
          finalSource,
          ensureIme: body.ensureIme,
          sendAfterCommit: body.sendAfterCommit
        });
        if (result.code !== 0) {
          sendJson(res, 500, { ...result, keys, logs });
          return;
        }
        await sleep(gapMs);
      }
    }

    sendJson(res, 200, { code: 0, stdout: logs.join("\n"), stderr: "" });
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => sendJson(res, 500, { error: error.message }));
  } else {
    serveStatic(req, res);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Xunfei Video Console: http://127.0.0.1:${PORT}`);
});
