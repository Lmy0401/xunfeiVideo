const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pinyin } = require("pinyin-pro");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADB_PATH = process.env.ADB_PATH || "D:\\Develop\\platform-tools\\adb.exe";
const PLAYBACK_SCRIPT = path.join(ROOT, "tools", "ime-tap-playback.ps1");
const RECORDINGS_DIR = path.join(ROOT, "recordings");
const PULL_TMP_DIR = path.join(ROOT, ".pull-tmp");
const SETTINGS_FILE = path.join(ROOT, "console-settings.json");
const TASKS_FILE = path.join(ROOT, "console-tasks.json");
const HISTORY_FILE = path.join(ROOT, "console-recordings.json");
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

function makeRunId() {
  const pad = value => String(value).padStart(2, "0");
  const now = new Date();
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return data;
}

function readSettings() {
  return readJsonFile(SETTINGS_FILE, { outputDir: "recordings" });
}

function writeSettings(nextSettings) {
  const settings = {
    ...readSettings(),
    ...nextSettings
  };
  return writeJsonFile(SETTINGS_FILE, settings);
}

function readTasks() {
  return readJsonFile(TASKS_FILE, []);
}

function saveTask(body) {
  const tasks = readTasks();
  const now = new Date().toISOString();
  const name = String(body.name || body.payload?.taskName || "").trim() || `任务 ${makeRunId()}`;
  const allowOverwrite = body.overwrite === true;
  const requestedId = String(body.id || "").trim();
  const id = allowOverwrite && requestedId ? requestedId : `${Date.now()}`;
  const nextTask = {
    id,
    name,
    updatedAt: now,
    payload: {
      ...body.payload,
      taskName: name
    }
  };
  const index = tasks.findIndex(task => task.id === id);
  if (index >= 0) {
    tasks[index] = nextTask;
  } else {
    tasks.unshift(nextTask);
  }
  writeJsonFile(TASKS_FILE, tasks.slice(0, 100));
  return nextTask;
}

function readRecordingHistory() {
  return readJsonFile(HISTORY_FILE, []);
}

function appendRecordingHistory(recording) {
  const history = readRecordingHistory();
  const nextHistory = [
    {
      ...recording,
      createdAt: new Date().toISOString()
    },
    ...history
  ].slice(0, 50);
  writeJsonFile(HISTORY_FILE, nextHistory);
  return nextHistory;
}

function safePathName(value, fallback) {
  return String(value || fallback || "untitled").trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim() || fallback || "untitled";
}

function resolveRecordingDir(outputDir, taskName) {
  const rawOutputDir = String(outputDir || "").trim();
  const baseDir = rawOutputDir
    ? path.resolve(ROOT, rawOutputDir)
    : RECORDINGS_DIR;
  return path.join(baseDir, safePathName(taskName, "未命名任务"));
}

function resolveVideoFileName(videoName, taskName) {
  const safeName = safePathName(videoName || taskName, "screenrecord");
  return safeName.toLowerCase().endsWith(".mp4") ? safeName : `${safeName}.mp4`;
}

function resolveUniqueFilePath(filePath, runId) {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath) || ".mp4";
  const base = path.basename(filePath, ext);
  return path.join(dir, `${base}-${runId}${ext}`);
}

function moveFileAcrossDevices(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }
    fs.copyFileSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
  }
}

async function selectOutputDir(initialDir) {
  const fallbackDir = path.resolve(ROOT, String(initialDir || readSettings().outputDir || "recordings"));
  const script = [
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$shell = New-Object -ComObject Shell.Application",
    `$initial = ${JSON.stringify(fallbackDir)}`,
    "$start = if (Test-Path -LiteralPath $initial) { $initial } else { 0 }",
    "$folder = $shell.BrowseForFolder(0, 'Select video output folder', 0, $start)",
    "if ($folder -ne $null) {",
    "  Write-Output $folder.Self.Path",
    "}"
  ].join("; ");

  const result = await runCommand("powershell", ["-NoProfile", "-STA", "-WindowStyle", "Normal", "-Command", script], {
    windowsHide: false
  });
  const selectedPath = result.stdout.trim();
  if (result.code === 0 && selectedPath) {
    writeSettings({ outputDir: selectedPath });
  }
  return { ...result, path: selectedPath };
}

function openFolder(folderPath) {
  return new Promise(resolve => {
    const child = spawn("explorer.exe", [folderPath], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.on("error", error => {
      resolve({ code: 1, stderr: error.message });
    });
    child.on("spawn", () => {
      child.unref();
      resolve({ code: 0, stdout: "", stderr: "" });
    });
  });
}


function textToKeys(text) {
  return pinyin(text || "", {
    toneType: "none",
    type: "array"
  }).join("").toLowerCase().replace(/[^a-z]/g, "");
}

function repeatKeySequence(keys, repeatCount) {
  const count = Math.max(1, Math.min(30, Number(repeatCount || 1)));
  return Array.from({ length: count }, () => keys).join("");
}

function getKeyTokens(value) {
  const tokens = [];
  let index = 0;
  const source = String(value || "");
  while (index < source.length) {
    if (source[index] === "{") {
      const end = source.indexOf("}", index + 1);
      if (end > index) {
        tokens.push(source.slice(index + 1, end).toLowerCase());
        index = end + 1;
        continue;
      }
    }
    tokens.push(source[index].toLowerCase());
    index++;
  }
  return tokens;
}

function applyKeySequenceToDraft(draft, keys) {
  const punctuation = {
    question: "？",
    "?": "？",
    "？": "？",
    exclamation: "！",
    "!": "！",
    "！": "！",
    comma: "，",
    ",": "，",
    "，": "，",
    period: "。",
    ".": "。",
    "。": "。",
    chineseperiod: "。",
    slash: "/",
    "/": "/",
    at: "@",
    "@": "@",
    ellipsis: "...",
    "...": "...",
    tilde: "~",
    "~": "~",
    colon: ":",
    ":": ":",
    dash: "-",
    "-": "-"
  };

  let result = draft;
  for (const token of getKeyTokens(keys)) {
    if (["backspace", "delete", "del", "bksp"].includes(token)) {
      result = result.slice(0, -1);
    } else if (token === "space") {
      result += " ";
    } else if (punctuation[token]) {
      result += punctuation[token];
    }
  }
  return result;
}

async function sendAppScript(scriptObject) {
  const script = JSON.stringify(scriptObject);
  const scriptBase64 = Buffer.from(script, "utf8").toString("base64");
  return runCommand(ADB_PATH, ["shell", "am", "start", "-n", "com.xunfei.video.showcase/.MainActivity", "--es", "scriptBase64", scriptBase64]);
}

async function clearAppBeforeRecord() {
  const result = await sendAppScript({
    actions: [
      { type: "clear" },
      { type: "wait", duration: 300 },
      { type: "scrollBottom" }
    ]
  });
  await sleep(500);
  return result;
}

async function runPlayback({ text, keys, layout, delayMs, commitDelayMs, startDelayMs, visualCandidateIndex, finalSource, ensureIme, sendAfterCommit, appendCommitText }) {
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
    if (sendAfterCommit !== false) {
      args.push("-SendAfterCommit");
    }
  } else if (useCandidateText) {
    if (sendAfterCommit !== false) {
      args.push("-SendAfterCommit");
    }
  } else {
    args.push("-CommitText", text, "-CommitDelayMs", String(commitDelayMs));
    if (appendCommitText) {
      args.push("-AppendCommitText");
    }
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

async function executeSequence(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const layout = body.layout === "nine" ? "nine" : "qwerty";
  const delayMs = Number(body.delayMs || 10);
  const commitDelayMs = Number(body.commitDelayMs || 20);
  const startDelayMs = Number(body.startDelayMs || 20);
  const gapMs = Number(body.gapMs || 650);
  const visualCandidateIndex = Number(body.visualCandidateIndex ?? body.candidateIndex ?? 0);
  const finalSource = body.finalSource === "candidate" ? "candidate" : "commit";
  const logs = [];
  let draftHasText = false;
  let draftText = "";

  if (!messages.length) {
    return { code: 1, stderr: "messages are required", logs };
  }

  for (let i = 0; i < messages.length; i++) {
    const item = messages[i];
    const side = item.side === "other" ? "other" : item.side === "keys" ? "keys" : "mine";
    const text = String(item.text || "").trim();
    if (!text) continue;

    const itemSendAfterCommit = side === "mine" ? item.sendAfterCommit !== false : side === "keys" ? item.sendAfterCommit === true : false;
    const nextItem = messages.slice(i + 1).find(next => String(next.text || "").trim());
    const pauseAfterItem = nextItem && nextItem.side === "keys" ? 0 : gapMs;
    const actorLabel = side === "other"
      ? "对方"
      : side === "keys" ? `按键${itemSendAfterCommit ? "（按后发送）" : ""}` : `我方${itemSendAfterCommit ? "" : "（不发送）"}`;
    logs.push(`${i + 1}. ${actorLabel}: ${text}`);

    if (side === "other") {
      const result = await sendAppScript({
        actions: [
          { type: "message", side: "other", text },
          { type: "wait", duration: gapMs }
        ]
      });
      if (result.code !== 0) {
        return { ...result, logs };
      }
      await sleep(pauseAfterItem);
    } else if (side === "keys") {
      const repeatCount = Math.max(1, Math.min(30, Number(item.repeatCount || 1)));
      const repeatedKeys = repeatKeySequence(text, repeatCount);
      logs[logs.length - 1] = `${logs[logs.length - 1]} x${repeatCount}`;
      const result = await runPlayback({
        text: "",
        keys: repeatedKeys,
        layout,
        delayMs,
        commitDelayMs,
        startDelayMs: i === 0 ? startDelayMs : 0,
        visualCandidateIndex: 0,
        finalSource: "none",
        ensureIme: i === 0 ? body.ensureIme : false,
        sendAfterCommit: false
      });
      if (result.code !== 0) {
        return { ...result, logs };
      }
      draftText = applyKeySequenceToDraft(draftText, repeatedKeys);
      if (itemSendAfterCommit && body.sendAfterCommit !== false) {
        const sendResult = await sendAppScript({
          actions: [
            { type: "commitText", text: draftText },
            { type: "wait", duration: commitDelayMs },
            { type: "send" }
          ]
        });
        if (sendResult.code !== 0) {
          return { ...sendResult, logs };
        }
        draftText = "";
      } else {
        const syncResult = await sendAppScript({
          actions: [
            { type: "commitText", text: draftText }
          ]
        });
        if (syncResult.code !== 0) {
          return { ...syncResult, logs };
        }
      }
      draftHasText = draftText.length > 0;
      await sleep(pauseAfterItem);
    } else {
      const keys = String(item.keys || textToKeys(text)).toLowerCase().replace(/[^a-z]/g, "");
      if (!keys) {
        return { code: 1, stderr: `message ${i + 1} keys could not be generated`, keys, logs };
      }
      const committedText = draftHasText && finalSource !== "candidate" ? `${draftText}${text}` : text;
      const result = await runPlayback({
        text: committedText,
        keys,
        layout,
        delayMs,
        commitDelayMs,
        startDelayMs,
        visualCandidateIndex,
        finalSource,
        ensureIme: body.ensureIme,
        sendAfterCommit: itemSendAfterCommit && body.sendAfterCommit !== false,
        appendCommitText: false
      });
      if (result.code !== 0) {
        return { ...result, keys, logs };
      }
      if (itemSendAfterCommit && body.sendAfterCommit !== false) {
        draftText = "";
      } else {
        draftText = committedText;
      }
      draftHasText = draftText.length > 0;
      await sleep(pauseAfterItem);
    }
  }

  return { code: 0, stdout: logs.join("\n"), stderr: "", logs };
}

function startScreenRecord(remotePath) {
  const child = spawn(ADB_PATH, ["shell", "screenrecord", remotePath], {
    cwd: ROOT,
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });
  const closed = new Promise(resolve => {
    child.on("error", error => resolve({ code: -1, stdout, stderr: error.message }));
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
  return { child, closed };
}

async function stopScreenRecord(recording) {
  if (!recording || recording.child.killed) {
    return { code: 0, stdout: "", stderr: "" };
  }

  // screenrecord finalizes the mp4 when interrupted. Keep a fallback so the
  // desktop process does not hang if adb ignores SIGINT on Windows.
  await runCommand(ADB_PATH, ["shell", "pkill", "-2", "screenrecord"]);
  await sleep(300);
  recording.child.kill("SIGINT");
  const timeout = sleep(3500).then(() => {
    if (!recording.child.killed) {
      recording.child.kill("SIGTERM");
    }
    return { code: 124, stdout: "", stderr: "screenrecord stop timeout" };
  });
  return Promise.race([recording.closed, timeout]);
}

async function recordSequence(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return { code: 1, stderr: "messages are required", logs: [] };
  }

  const runId = makeRunId();
  const outputDir = body.outputDir || readSettings().outputDir;
  const taskName = String(body.taskName || "").trim() || "未命名任务";
  const runDir = resolveRecordingDir(outputDir, taskName);
  const remotePath = `/sdcard/xunfei-record-${runId}.mp4`;
  const videoFileName = resolveVideoFileName(body.videoName, taskName);
  const localPath = resolveUniqueFilePath(path.join(runDir, videoFileName), runId);
  const tempPullPath = path.join(PULL_TMP_DIR, `${runId}.mp4`);
  const logs = [`录制任务 ${runId}`];
  let recording = null;

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(PULL_TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(runDir, `task-${runId}.json`), JSON.stringify(body, null, 2), "utf8");

  const devices = await runCommand(ADB_PATH, ["devices"]);
  if (devices.code !== 0 || !/\tdevice\b/.test(devices.stdout)) {
    return { code: 1, stderr: "no adb device is online", stdout: logs.join("\n"), runId, runDir };
  }

  const clearResult = await clearAppBeforeRecord();
  if (clearResult.code !== 0) {
    return { ...clearResult, stdout: logs.concat("录制前清屏失败").join("\n"), runId, runDir };
  }
  logs.push("录制前已清屏");

  await runCommand(ADB_PATH, ["shell", "rm", "-f", remotePath]);
  recording = startScreenRecord(remotePath);
  logs.push(`开始录屏: ${remotePath}`);
  await sleep(Number(body.recordPrerollMs || 800));

  const sequenceResult = await executeSequence(body);
  logs.push(sequenceResult.stdout || sequenceResult.logs?.join("\n") || "");
  await sleep(Number(body.recordPostrollMs || 1000));

  const stopResult = await stopScreenRecord(recording);
  logs.push("录屏已停止，正在拉取文件");
  await sleep(800);

  const pullResult = await runCommand(ADB_PATH, ["pull", remotePath, tempPullPath]);
  await runCommand(ADB_PATH, ["shell", "rm", "-f", remotePath]);

  if (sequenceResult.code !== 0) {
    return { ...sequenceResult, stdout: logs.filter(Boolean).join("\n"), stopResult, pullResult, runId, runDir, localPath };
  }
  if (pullResult.code !== 0) {
    return { ...pullResult, stdout: logs.filter(Boolean).join("\n"), stopResult, runId, runDir, localPath };
  }

  moveFileAcrossDevices(tempPullPath, localPath);
  const stats = fs.statSync(localPath);
  appendRecordingHistory({
    runId,
    taskName,
    runDir,
    localPath,
    sizeBytes: stats.size
  });
  return {
    code: 0,
    stdout: logs.filter(Boolean).join("\n"),
    stderr: pullResult.stderr || stopResult.stderr || "",
    runId,
    runDir,
    localPath,
    remotePath,
    sizeBytes: stats.size,
    stopResult,
    pullResult
  };
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

  if (req.method === "GET" && req.url === "/api/settings") {
    sendJson(res, 200, readSettings());
    return;
  }

  if (req.method === "POST" && req.url === "/api/settings") {
    const body = await readJson(req);
    const outputDir = String(body.outputDir || "").trim();
    const settings = writeSettings({ outputDir: outputDir || "recordings" });
    sendJson(res, 200, settings);
    return;
  }

  if (req.method === "GET" && req.url === "/api/tasks") {
    sendJson(res, 200, { tasks: readTasks() });
    return;
  }

  if (req.method === "POST" && req.url === "/api/tasks") {
    const body = await readJson(req);
    const task = saveTask(body);
    sendJson(res, 200, { task, tasks: readTasks() });
    return;
  }

  if (req.method === "GET" && req.url === "/api/recordings") {
    sendJson(res, 200, { recordings: readRecordingHistory() });
    return;
  }

  if (req.method === "POST" && req.url === "/api/open-folder") {
    const body = await readJson(req);
    const folderPath = path.resolve(ROOT, String(body.path || ""));
    if (!fs.existsSync(folderPath)) {
      sendJson(res, 404, { error: "folder not found" });
      return;
    }
    const result = await openFolder(folderPath);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && req.url === "/api/select-output-dir") {
    const body = await readJson(req);
    const result = await selectOutputDir(body.initialDir);
    if (result.code !== 0) {
      sendJson(res, 500, result);
      return;
    }
    if (!result.path) {
      sendJson(res, 200, { code: 0, cancelled: true, path: "" });
      return;
    }
    sendJson(res, 200, { code: 0, cancelled: false, path: result.path });
    return;
  }

  if (req.method === "POST" && req.url === "/api/run") {
    const body = await readJson(req);
    const text = String(body.text || "").trim();
    const keys = String(body.keys || textToKeys(text)).trim().toLowerCase().replace(/[^a-z]/g, "");
    const layout = body.layout === "nine" ? "nine" : "qwerty";
    const delayMs = Number(body.delayMs || 10);
    const commitDelayMs = Number(body.commitDelayMs || 20);
    const startDelayMs = Number(body.startDelayMs || 20);
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
    const result = await executeSequence(body);
    sendJson(res, result.code === 0 ? 200 : 500, result);
    return;
  }

  if (req.method === "POST" && req.url === "/api/record-sequence") {
    const body = await readJson(req);
    const result = await recordSequence(body);
    sendJson(res, result.code === 0 ? 200 : 500, result);
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
