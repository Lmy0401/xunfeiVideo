const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pinyin } = require("pinyin-pro");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADB_PATH = process.env.ADB_PATH || "D:\\Develop\\platform-tools\\adb.exe";
const PLAYBACK_SCRIPT = path.join(ROOT, "tools", "ime-tap-playback.ps1");
const SCRCPY_PATH = process.env.SCRCPY_PATH || findScrcpyPath();
const JY_SKILL_ROOT = process.env.JY_SKILL_ROOT || path.join(ROOT, ".pull-tmp", "jianying-editor-skill");
const JY_PYTHON_PATH = process.env.JY_PYTHON_PATH || path.join(ROOT, ".pull-tmp", "jy-skill-venv", "Scripts", "python.exe");
const JY_PROJECTS_ROOT = process.env.JY_PROJECTS_ROOT || "C:\\Users\\22914\\AppData\\Local\\JianyingPro\\User Data\\Projects\\com.lveditor.draft";
const JY_FFPROBE_DIR = process.env.JY_FFPROBE_DIR || "D:\\EVCapture";
const RECORDINGS_DIR = path.join(ROOT, "recordings");
const PULL_TMP_DIR = path.join(ROOT, ".pull-tmp");
const SETTINGS_FILE = path.join(ROOT, "console-settings.json");
const TASKS_FILE = path.join(ROOT, "console-tasks.json");
const HISTORY_FILE = path.join(ROOT, "console-recordings.json");
const JY_TEMPLATE_FILE = path.join(ROOT, "jianying-template.json");
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

function findScrcpyPath() {
  const toolsDir = path.join(ROOT, "tools");
  const directPath = path.join(toolsDir, "scrcpy.exe");
  if (fs.existsSync(directPath)) {
    return directPath;
  }
  try {
    const entry = fs.readdirSync(toolsDir, { withFileTypes: true })
      .filter(item => item.isDirectory() && item.name.toLowerCase().includes("scrcpy"))
      .map(item => path.join(toolsDir, item.name, "scrcpy.exe"))
      .find(candidate => fs.existsSync(candidate));
    if (entry) {
      return entry;
    }
  } catch (error) {
    // Missing tools directory is fine; adb screenrecord remains the fallback.
  }
  return "scrcpy";
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
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return data;
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (quoted && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function inferAssetAccess(row) {
  const text = Object.values(row).join(" ").toLowerCase();
  if (/(^|\b)(vip|svip|premium|paid)(\b|$)|会员|付费/.test(text)) {
    return "vip";
  }
  if (/(^|\b)free(\b|$)|免费|限免/.test(text)) {
    return "free";
  }
  return "unknown";
}

function readJianyingAssetCsv(fileName) {
  const filePath = path.join(JY_SKILL_ROOT, "data", fileName);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const lines = fs.readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
  if (lines.length < 2) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });
    const id = row.id || row.music_id || row.effect_id || row.identifier || "";
    const name = row.name || row.title || row.name_hint || id;
    const rawDuration = Number(row.duration_s || row.duration || 0);
    const duration = fileName === "cloud_video_assets.csv" && rawDuration > 60
      ? rawDuration / 1000
      : rawDuration;
    return {
      id,
      name,
      duration,
      categories: row.categories || row.type || "",
      accessLevel: inferAssetAccess(row),
      url: row.url || "",
      source: fileName
    };
  }).filter(item => item.id && item.name && (fileName !== "cloud_video_assets.csv" || item.url));
}

function readJianyingAssets(type) {
  if (type === "sfx") {
    return readJianyingAssetCsv("cloud_sound_effects.csv");
  }
  if (type === "music") {
    return readJianyingAssetCsv("cloud_music_library.csv");
  }
  if (type === "video") {
    return readJianyingAssetCsv("cloud_video_assets.csv");
  }
  if (type === "text-animation") {
    return readJianyingAssetCsv("text_animations.csv");
  }
  return [];
}

function readSettings() {
  const settings = readJsonFile(SETTINGS_FILE, { outputDir: "recordings" });
  return {
    ...settings,
    outputDir: cleanOutputDir(settings.outputDir, "recordings")
  };
}

function writeSettings(nextSettings) {
  const settings = {
    ...readSettings(),
    ...nextSettings,
    outputDir: cleanOutputDir(nextSettings.outputDir ?? readSettings().outputDir, "recordings")
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

function updateRecordingHistory(runId, patch) {
  if (!runId) {
    return readRecordingHistory();
  }
  const history = readRecordingHistory();
  const nextHistory = history.map(item => item.runId === runId ? { ...item, ...patch } : item);
  writeJsonFile(HISTORY_FILE, nextHistory);
  return nextHistory;
}

function safePathName(value, fallback) {
  return String(value || fallback || "untitled").trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim() || fallback || "untitled";
}

function cleanOutputDir(value, fallback = "recordings") {
  const cleaned = String(value || "")
    .replace(/\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\)\s+\[[^\]]+\].*$/s, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean);
  return cleaned || fallback;
}

function resolveRecordingDir(outputDir, taskName) {
  const rawOutputDir = cleanOutputDir(outputDir, "");
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

function inspectMp4Tracks(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const countToken = token => {
      const needle = Buffer.from(token);
      let count = 0;
      let index = 0;
      while ((index = data.indexOf(needle, index)) !== -1) {
        count += 1;
        index += needle.length;
      }
      return count;
    };
    return {
      hasMoov: data.indexOf(Buffer.from("moov")) >= 0,
      videoTracks: countToken("vide"),
      audioTracks: countToken("soun")
    };
  } catch (error) {
    return { hasMoov: false, videoTracks: 0, audioTracks: 0 };
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

  const result = await runCommand("powershell", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script], {
    windowsHide: true
  });
  const selectedPath = cleanOutputDir(result.stdout, "");
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

async function createJianyingDraft(body) {
  const videoPath = path.resolve(ROOT, String(body.localPath || body.videoPath || ""));
  if (!fs.existsSync(videoPath)) {
    return { code: 1, stderr: `video not found: ${videoPath}` };
  }

  const runId = String(body.runId || "").trim();
  const baseName = safePathName(body.taskName || path.basename(videoPath, path.extname(videoPath)), "XunfeiVideo");
  const projectName = safePathName(body.projectName || `${baseName}-${makeRunId()}`, "XunfeiVideo");
  const args = [
    path.join(ROOT, "scripts", "create_jianying_draft.py"),
    "--video", videoPath,
    "--name", projectName,
    "--title", String(body.title || body.taskName || "").trim(),
    "--draft-root", JY_PROJECTS_ROOT,
    "--template", path.join(ROOT, "jianying-template.json"),
    "--overwrite"
  ];

  const env = {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    JY_SKILL_ROOT,
    JY_PROJECTS_ROOT,
    PATH: fs.existsSync(JY_FFPROBE_DIR) ? `${JY_FFPROBE_DIR};${process.env.PATH}` : process.env.PATH
  };
  const result = await runCommand(JY_PYTHON_PATH, args, { env });
  let parsed = null;
  const jsonLine = String(result.stdout || "").split(/\r?\n/).reverse().find(line => line.trim().startsWith("{"));
  if (jsonLine) {
    try {
      parsed = JSON.parse(jsonLine);
    } catch (error) {
      parsed = null;
    }
  }
  const draft = parsed?.data?.draft || "";
  if (result.code === 0 && draft) {
    updateRecordingHistory(runId, {
      jianyingDraft: {
        projectName,
        draftPath: draft,
        createdAt: new Date().toISOString()
      }
    });
  }
  return {
    ...result,
    parsed,
    projectName,
    draftPath: draft
  };
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

function estimateRecordLimitSeconds(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const delayMs = Number(body.delayMs || 10);
  const startDelayMs = Number(body.startDelayMs || 20);
  const commitDelayMs = Number(body.commitDelayMs || 20);
  const gapMs = Number(body.gapMs || 650);
  const prerollMs = Number(body.recordPrerollMs || 800);
  const postrollMs = Number(body.recordPostrollMs || 1000);
  const sequenceMs = messages.reduce((total, item, index) => {
    const text = String(item.text || "");
    const repeatCount = item.side === "keys" ? Math.max(1, Math.min(30, Number(item.repeatCount || 1))) : 1;
    const keyCount = item.side === "other" ? 0 : (item.side === "keys" ? getKeyTokens(text).length * repeatCount : textToKeys(text).length);
    const startupMs = index === 0 ? startDelayMs : 0;
    return total + startupMs + keyCount * delayMs + commitDelayMs + gapMs + 2500;
  }, 0);
  const requested = Number(body.recordTimeLimitSeconds || body.recordTimeLimitSec || 0);
  if (requested > 0) {
    return Math.max(3, Math.ceil(requested));
  }
  return Math.max(8, Math.ceil((prerollMs + sequenceMs + postrollMs + 5000) / 1000));
}

function startScrcpyRecord(localPath, timeLimitSeconds) {
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const args = [
    "--no-window",
    "--no-playback",
    "--require-audio",
    "--audio-source=playback",
    "--audio-dup",
    "--time-limit", String(timeLimitSeconds),
    "--record", localPath
  ];
  const child = spawn(SCRCPY_PATH, args, {
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
  return { child, closed, timeLimitSeconds };
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

async function stopScrcpyRecord(recording) {
  if (!recording || recording.child.killed) {
    return { code: 0, stdout: "", stderr: "" };
  }

  const waitMs = (Number(recording.timeLimitSeconds || 0) * 1000) + 8000;
  const timeout = sleep(Math.max(8000, waitMs)).then(() => {
    if (!recording.child.killed) {
      recording.child.kill("SIGTERM");
    }
    return { code: 124, stdout: "", stderr: "scrcpy time-limit stop timeout" };
  });
  return Promise.race([recording.closed, timeout]);
}

async function waitForEarlyExit(recording, ms = 1200) {
  return Promise.race([
    recording.closed,
    sleep(ms).then(() => null)
  ]);
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
  let useScrcpy = false;

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
  const scrcpyCheck = await runCommand(SCRCPY_PATH, ["--version"]);
  useScrcpy = scrcpyCheck.code === 0;
  const scrcpyTimeLimitSeconds = useScrcpy ? estimateRecordLimitSeconds(body) : 0;
  recording = useScrcpy ? startScrcpyRecord(localPath, scrcpyTimeLimitSeconds) : startScreenRecord(remotePath);
  logs.push(useScrcpy ? `开始录屏: ${localPath}` : `开始录屏: ${remotePath}`);
  logs.push(useScrcpy
    ? `Start scrcpy recording with audio: ${localPath} (${scrcpyTimeLimitSeconds}s)`
    : `Start adb screenrecord without audio: ${remotePath}`);
  await sleep(Number(body.recordPrerollMs || 800));
  const earlyExit = await waitForEarlyExit(recording);
  if (earlyExit) {
    return {
      ...earlyExit,
      code: earlyExit.code === 0 ? 1 : earlyExit.code,
      stdout: logs.filter(Boolean).join("\n"),
      stderr: earlyExit.stderr || earlyExit.stdout || "recording process exited before playback",
      runId,
      runDir,
      localPath
    };
  }

  const sequenceResult = await executeSequence(body);
  logs.push(sequenceResult.stdout || sequenceResult.logs?.join("\n") || "");
  await sleep(Number(body.recordPostrollMs || 1000));

  const stopResult = useScrcpy ? await stopScrcpyRecord(recording) : await stopScreenRecord(recording);
  logs.push(useScrcpy ? "scrcpy 录屏已停止" : "录屏已停止，正在拉取文件");
  if (!useScrcpy) {
    await sleep(800);
  }

  let pullResult = { code: 0, stdout: "", stderr: "" };
  if (!useScrcpy) {
    pullResult = await runCommand(ADB_PATH, ["pull", remotePath, tempPullPath]);
    await runCommand(ADB_PATH, ["shell", "rm", "-f", remotePath]);
  }

  if (sequenceResult.code !== 0) {
    return { ...sequenceResult, stdout: logs.filter(Boolean).join("\n"), stopResult, pullResult, runId, runDir, localPath };
  }
  if (pullResult.code !== 0) {
    return { ...pullResult, stdout: logs.filter(Boolean).join("\n"), stopResult, runId, runDir, localPath };
  }

  if (!useScrcpy) {
    moveFileAcrossDevices(tempPullPath, localPath);
  }
  if (!fs.existsSync(localPath)) {
    return {
      code: 1,
      stdout: logs.filter(Boolean).join("\n"),
      stderr: useScrcpy
        ? `scrcpy did not create output file: ${localPath}`
        : `recording file was not created: ${localPath}`,
      stopResult,
      pullResult,
      runId,
      runDir,
      localPath
    };
  }
  const stats = fs.statSync(localPath);
  const mediaTracks = inspectMp4Tracks(localPath);
  logs.push(mediaTracks.audioTracks > 0
    ? `Audio track detected: ${mediaTracks.audioTracks}`
    : "Audio track not detected");
  appendRecordingHistory({
    runId,
    taskName,
    runDir,
    localPath,
    sizeBytes: stats.size,
    mediaTracks
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
    mediaTracks,
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

  if (req.method === "GET" && req.url === "/api/jianying-template") {
    sendJson(res, 200, readJsonFile(JY_TEMPLATE_FILE, {}));
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/jianying-assets")) {
    const url = new URL(req.url, "http://localhost");
    const type = url.searchParams.get("type") || "music";
    const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const assets = readJianyingAssets(type)
      .filter(item => !query || item.name.toLowerCase().includes(query) || item.id.includes(query))
      .slice(0, 300);
    sendJson(res, 200, { assets });
    return;
  }

  if (req.method === "POST" && req.url === "/api/jianying-template") {
    const body = await readJson(req);
    sendJson(res, 200, writeJsonFile(JY_TEMPLATE_FILE, body));
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

  if (req.method === "POST" && req.url === "/api/create-jianying-draft") {
    const body = await readJson(req);
    const result = await createJianyingDraft(body);
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
