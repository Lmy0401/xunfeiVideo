const delayInput = document.querySelector("#delayInput");
const commitDelayInput = document.querySelector("#commitDelayInput");
const startDelayInput = document.querySelector("#startDelayInput");
const candidateInput = document.querySelector("#candidateInput");
const finalSourceInput = document.querySelector("#finalSourceInput");
const outputDirInput = document.querySelector("#outputDirInput");
const videoNameInput = document.querySelector("#videoNameInput");
const selectOutputDirBtn = document.querySelector("#selectOutputDirBtn");
const ensureImeInput = document.querySelector("#ensureImeInput");
const sendInput = document.querySelector("#sendInput");
const runBtn = document.querySelector("#runBtn");
const recordBtn = document.querySelector("#recordBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const clearLogBtn = document.querySelector("#clearLogBtn");
const saveTaskBtn = document.querySelector("#saveTaskBtn");
const loadTaskBtn = document.querySelector("#loadTaskBtn");
const taskNameInput = document.querySelector("#taskNameInput");
const taskSelect = document.querySelector("#taskSelect");
const refreshRecordingsBtn = document.querySelector("#refreshRecordingsBtn");
const addMineBtn = document.querySelector("#addMineBtn");
const addOtherBtn = document.querySelector("#addOtherBtn");
const addKeysBtn = document.querySelector("#addKeysBtn");
const messageList = document.querySelector("#messageList");
const recordingList = document.querySelector("#recordingList");
const logOutput = document.querySelector("#logOutput");
const deviceState = document.querySelector("#deviceState");
const flowLabel = document.querySelector("#flowLabel");
const layoutButtons = [...document.querySelectorAll("[data-layout]")];

let currentLayout = "qwerty";
let currentTaskId = "";
let savedTasks = [];
let messages = [
  { side: "mine", text: "今天换了一个新的壁纸", sendAfterCommit: false },
  { side: "keys", text: "{backspace}", repeatCount: 1 },
  { side: "other", text: "看起来很清新" },
  { side: "mine", text: "打字的时候还有动态效果", sendAfterCommit: true }
];

function log(message) {
  const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  logOutput.textContent += `[${time}] ${message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.stderr || data.error || `HTTP ${response.status}`);
  }
  return data;
}

function renderMessages() {
  messageList.innerHTML = "";
  messages.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = `message-row ${item.side}`;
    row.innerHTML = `
      <div class="order">${index + 1}</div>
      <select class="side-select" aria-label="发送方">
        <option value="mine"${item.side === "mine" ? " selected" : ""}>我方</option>
        <option value="other"${item.side === "other" ? " selected" : ""}>对方</option>
        <option value="keys"${item.side === "keys" ? " selected" : ""}>按键</option>
      </select>
      <textarea class="message-text" rows="2" spellcheck="false" placeholder="${item.side === "keys" ? "例如 {backspace}{space}{symbol}" : "输入消息内容"}">${escapeHtml(item.text)}</textarea>
      <label class="row-repeat ${item.side === "keys" ? "" : "disabled"}" title="按键行会把当前按键序列重复执行指定次数">
        <span>次数</span>
        <input type="number" min="1" max="30" step="1" value="${Number(item.repeatCount || 1)}" ${item.side === "keys" ? "" : "disabled"}>
      </label>
      <label class="row-send ${item.side === "mine" || item.side === "keys" ? "" : "disabled"}" title="我方可只输入不发送；按键可在执行后发送当前输入框内容">
        <input type="checkbox" ${item.sendAfterCommit === true || (item.side === "mine" && item.sendAfterCommit !== false) ? "checked" : ""} ${item.side === "mine" || item.side === "keys" ? "" : "disabled"}>
        <span>${item.side === "keys" ? "按后发送" : "发送本条"}</span>
      </label>
      <div class="row-actions">
        <button type="button" data-action="up" title="上移">↑</button>
        <button type="button" data-action="down" title="下移">↓</button>
        <button type="button" data-action="delete" title="删除">×</button>
      </div>
    `;

    row.querySelector(".side-select").addEventListener("change", event => {
      messages[index].side = event.target.value;
      if (messages[index].side === "mine") {
        messages[index].sendAfterCommit = messages[index].sendAfterCommit !== false;
      } else if (messages[index].side === "keys") {
        messages[index].sendAfterCommit = false;
        messages[index].repeatCount = Number(messages[index].repeatCount || 1);
      }
      renderMessages();
    });
    row.querySelector(".message-text").addEventListener("input", event => {
      messages[index].text = event.target.value;
    });
    row.querySelector(".row-send input").addEventListener("change", event => {
      messages[index].sendAfterCommit = event.target.checked;
    });
    row.querySelector(".row-repeat input").addEventListener("input", event => {
      messages[index].repeatCount = Math.max(1, Math.min(30, Number(event.target.value || 1)));
    });
    row.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", () => handleRowAction(index, button.dataset.action));
    });

    messageList.appendChild(row);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "";
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function handleRowAction(index, action) {
  if (action === "delete") {
    messages.splice(index, 1);
  } else if (action === "up" && index > 0) {
    [messages[index - 1], messages[index]] = [messages[index], messages[index - 1]];
  } else if (action === "down" && index < messages.length - 1) {
    [messages[index + 1], messages[index]] = [messages[index], messages[index + 1]];
  }
  renderMessages();
}

async function refreshDevices() {
  deviceState.textContent = "检测中";
  deviceState.className = "state";
  try {
    const data = await requestJson("/api/devices");
    const hasDevice = /\tdevice\b/.test(data.stdout);
    deviceState.textContent = hasDevice ? "设备已连接" : "未发现设备";
    deviceState.className = `state ${hasDevice ? "ok" : "bad"}`;
    log((data.stdout || "").trim() || "adb devices 无输出");
  } catch (error) {
    deviceState.textContent = "ADB 异常";
    deviceState.className = "state bad";
    log(error.message);
  }
}

function collectMessages() {
  return messages
    .map(item => ({
      side: item.side,
      text: item.text.trim(),
      repeatCount: item.side === "keys" ? Math.max(1, Math.min(30, Number(item.repeatCount || 1))) : 1,
      sendAfterCommit: item.side === "mine" ? item.sendAfterCommit !== false : item.side === "keys" ? item.sendAfterCommit === true : false
    }))
    .filter(item => item.text);
}

function collectPayload() {
  return {
    taskName: taskNameInput.value.trim(),
    messages: collectMessages(),
    layout: currentLayout,
    delayMs: Number(delayInput.value),
    commitDelayMs: Number(commitDelayInput.value),
    startDelayMs: Number(startDelayInput.value),
    visualCandidateIndex: Number(candidateInput.value),
    finalSource: finalSourceInput.value,
    outputDir: outputDirInput.value.trim(),
    videoName: videoNameInput.value.trim(),
    ensureIme: ensureImeInput.checked,
    sendAfterCommit: sendInput.checked
  };
}

function applyPayload(payload) {
  if (!payload) return;
  taskNameInput.value = payload.taskName || taskNameInput.value;
  messages = Array.isArray(payload.messages) ? payload.messages : messages;
  currentLayout = payload.layout === "nine" ? "nine" : "qwerty";
  delayInput.value = payload.delayMs ?? delayInput.value;
  commitDelayInput.value = payload.commitDelayMs ?? commitDelayInput.value;
  startDelayInput.value = payload.startDelayMs ?? startDelayInput.value;
  candidateInput.value = payload.visualCandidateIndex ?? candidateInput.value;
  finalSourceInput.value = payload.finalSource || finalSourceInput.value;
  outputDirInput.value = payload.outputDir || outputDirInput.value;
  videoNameInput.value = payload.videoName || videoNameInput.value;
  ensureImeInput.checked = payload.ensureIme !== false;
  sendInput.checked = payload.sendAfterCommit !== false;
  layoutButtons.forEach(item => item.classList.toggle("active", item.dataset.layout === currentLayout));
  renderMessages();
}

function logPayloadSummary(payload) {
  log(`开始执行 ${payload.messages.length} 条消息`);
  payload.messages.forEach((item, index) => {
    const label = item.side === "mine"
      ? `我方${item.sendAfterCommit ? "" : "（不发送）"}`
      : item.side === "other" ? "对方" : `按键×${item.repeatCount}${item.sendAfterCommit ? "（按后发送）" : ""}`;
    log(`${index + 1}. ${label}：${item.text}`);
  });
  log(payload.visualCandidateIndex > 0
    ? `候选词效果：点击第 ${payload.visualCandidateIndex} 个候选词`
    : "候选词效果：不点击");
  log(payload.finalSource === "candidate"
    ? "最终文本：使用候选词"
    : "最终文本：强制使用发送内容");
}

function setRunning(isRunning) {
  runBtn.disabled = isRunning;
  recordBtn.disabled = isRunning;
}

async function runTask() {
  const payload = collectPayload();

  if (!payload.messages.length) {
    log("聊天顺序为空");
    return;
  }

  setRunning(true);
  flowLabel.textContent = "执行中";
  logPayloadSummary(payload);

  try {
    const result = await requestJson("/api/run-sequence", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (result.stdout && result.stdout.trim()) log(result.stdout.trim());
    if (result.stderr && result.stderr.trim()) log(result.stderr.trim());
    log("聊天脚本完成");
    flowLabel.textContent = "完成";
  } catch (error) {
    log(`执行失败：${error.message}`);
    flowLabel.textContent = "失败";
  } finally {
    setRunning(false);
  }
}

async function loadSettings() {
  try {
    const settings = await requestJson("/api/settings");
    if (settings.outputDir) {
      outputDirInput.value = settings.outputDir;
    }
  } catch (error) {
    log(`读取设置失败：${error.message}`);
  }
}

async function saveOutputSettings() {
  try {
    await requestJson("/api/settings", {
      method: "POST",
      body: JSON.stringify({ outputDir: outputDirInput.value.trim() || "recordings" })
    });
  } catch (error) {
    log(`保存输出文件夹失败：${error.message}`);
  }
}

async function loadTasks() {
  try {
    const data = await requestJson("/api/tasks");
    savedTasks = Array.isArray(data.tasks) ? data.tasks : [];
    taskSelect.innerHTML = savedTasks.length
      ? savedTasks.map(task => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.name)} · ${escapeHtml(formatTime(task.updatedAt))}</option>`).join("")
      : `<option value="">暂无保存任务</option>`;
    if (currentTaskId) {
      taskSelect.value = currentTaskId;
    }
  } catch (error) {
    log(`读取任务失败：${error.message}`);
  }
}

async function saveTask() {
  const payload = collectPayload();
  const name = payload.taskName || `任务 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
  if (!payload.messages.length) {
    log("聊天顺序为空，未保存任务");
    return;
  }

  try {
    const result = await requestJson("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ name, payload })
    });
    currentTaskId = result.task.id;
    taskNameInput.value = result.task.name;
    await loadTasks();
    log(`任务已保存：${result.task.name}`);
  } catch (error) {
    log(`保存任务失败：${error.message}`);
  }
}

function loadSelectedTask() {
  const task = savedTasks.find(item => item.id === taskSelect.value);
  if (!task) {
    log("请选择一个已保存任务");
    return;
  }
  currentTaskId = task.id;
  applyPayload(task.payload);
  log(`任务已加载：${task.name}`);
}

async function loadRecentRecordings() {
  try {
    const data = await requestJson("/api/recordings");
    const recordings = Array.isArray(data.recordings) ? data.recordings : [];
    recordingList.innerHTML = recordings.length
      ? recordings.map(item => `
        <article class="recording-item">
          <strong>${escapeHtml(item.taskName || "未命名任务")}</strong>
          <div class="recording-meta">${escapeHtml(formatTime(item.createdAt))} · ${escapeHtml(formatSize(item.sizeBytes))}</div>
          <div class="recording-path">${escapeHtml(item.localPath || "")}</div>
          <button class="text-btn" type="button" data-open-folder="${escapeHtml(item.runDir || "")}">打开文件夹</button>
        </article>
      `).join("")
      : `<div class="recording-meta">暂无录制记录</div>`;
  } catch (error) {
    recordingList.innerHTML = `<div class="recording-meta">读取失败：${escapeHtml(error.message)}</div>`;
  }
}

async function recordTask() {
  const payload = collectPayload();

  if (!payload.messages.length) {
    log("聊天顺序为空");
    return;
  }

  setRunning(true);
  flowLabel.textContent = "录制中";
  log("开始录制并拉取视频");
  logPayloadSummary(payload);

  try {
    await saveOutputSettings();
    const result = await requestJson("/api/record-sequence", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (result.stdout && result.stdout.trim()) log(result.stdout.trim());
    if (result.stderr && result.stderr.trim()) log(result.stderr.trim());
    log(`视频已保存：${result.localPath}`);
    if (result.sizeBytes) {
      log(`文件大小：${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
    }
    await loadRecentRecordings();
    flowLabel.textContent = "录制完成";
  } catch (error) {
    log(`录制失败：${error.message}`);
    flowLabel.textContent = "录制失败";
  } finally {
    setRunning(false);
  }
}

async function openRecordingFolder(folderPath) {
  if (!folderPath) return;
  try {
    await requestJson("/api/open-folder", {
      method: "POST",
      body: JSON.stringify({ path: folderPath })
    });
  } catch (error) {
    log(`打开文件夹失败：${error.message}`);
  }
}

async function selectOutputDir() {
  selectOutputDirBtn.disabled = true;
  try {
    const result = await requestJson("/api/select-output-dir", {
      method: "POST",
      body: JSON.stringify({ initialDir: outputDirInput.value.trim() })
    });
    if (result.cancelled) {
      log("已取消选择输出文件夹");
      return;
    }
    outputDirInput.value = result.path;
    await saveOutputSettings();
    log(`输出文件夹：${result.path}`);
  } catch (error) {
    log(`选择输出文件夹失败：${error.message}`);
  } finally {
    selectOutputDirBtn.disabled = false;
  }
}

layoutButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentLayout = button.dataset.layout;
    layoutButtons.forEach(item => item.classList.toggle("active", item === button));
  });
});

addMineBtn.addEventListener("click", () => {
  messages.push({ side: "mine", text: "", sendAfterCommit: true });
  renderMessages();
});
addOtherBtn.addEventListener("click", () => {
  messages.push({ side: "other", text: "" });
  renderMessages();
});
addKeysBtn.addEventListener("click", () => {
  messages.push({ side: "keys", text: "{backspace}", repeatCount: 1, sendAfterCommit: false });
  renderMessages();
});
refreshBtn.addEventListener("click", refreshDevices);
runBtn.addEventListener("click", runTask);
recordBtn.addEventListener("click", recordTask);
selectOutputDirBtn.addEventListener("click", selectOutputDir);
outputDirInput.addEventListener("change", saveOutputSettings);
saveTaskBtn.addEventListener("click", saveTask);
loadTaskBtn.addEventListener("click", loadSelectedTask);
refreshRecordingsBtn.addEventListener("click", loadRecentRecordings);
recordingList.addEventListener("click", event => {
  const button = event.target.closest("[data-open-folder]");
  if (button) {
    openRecordingFolder(button.dataset.openFolder);
  }
});
clearLogBtn.addEventListener("click", () => {
  logOutput.textContent = "";
});

renderMessages();
loadSettings();
loadTasks();
loadRecentRecordings();
refreshDevices();
