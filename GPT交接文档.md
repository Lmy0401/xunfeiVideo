# XunfeiVideo 项目迁移与 GPT 交接文档

本文档用于把当前项目迁移到另一台电脑继续开发，并让另一台电脑上的 GPT 快速理解项目目标、当前进度和下一步工作。

## 1. 项目在做什么

项目名：`XunfeiVideo`

目标：做一个“输入法皮肤展示视频自动化系统”的原型。核心思路是：

1. Android 真机运行一个仿聊天场景的演示 App。
2. 用真实系统输入法弹出键盘，展示输入法皮肤、按键反馈和候选栏效果。
3. 桌面端通过 ADB 控制手机：启动 App、聚焦输入框、点击真实输入法坐标、提交聊天文本、插入对方消息。
4. 后续再接入录屏、拉取视频、FFmpeg 合成、旁白、字幕、BGM、批量任务等能力。

当前重点不是做完整生产系统，而是验证：真实输入法皮肤能否稳定逐键回放、录屏展示，并形成可操作的 MVP 工作流。

## 2. 当前项目结构

```text
XunfeiVideo/
├─ app/                         Android 原生演示 App
│  └─ src/main/java/com/xunfei/video/showcase/MainActivity.java
├─ console/                     本地 Web 控制台，Node.js 服务 + 静态页面
│  ├─ server.js
│  ├─ package.json
│  ├─ package-lock.json
│  └─ public/
│     ├─ index.html
│     ├─ app.js
│     └─ style.css
├─ tools/
│  └─ ime-tap-playback.ps1      PowerShell + ADB 坐标点击脚本
├─ svg/                         图标或素材草稿
├─ andorid-device/              设备相关资料目录，原目录名就是这个拼写
├─ README.md                    当前运行说明
├─ 项目计划书.md                产品与阶段规划
├─ settings.gradle
├─ build.gradle
└─ local.properties             本机 Android SDK 路径，不建议迁移复用
```

## 3. 当前已经做到哪一步

### Android App

- 已有最小 Android 原生工程，模块名为 `app`，包名为 `com.xunfei.video.showcase`。
- 主界面是竖屏单聊界面，包含顶部聊天栏、消息列表、底部输入栏。
- 使用真实 `EditText` 调起系统输入法，而不是纯模拟键盘。
- 支持手动输入并发送消息。
- 支持通过 ADB 传入 JSON 脚本自动执行聊天动作。
- 支持脚本动作：`clear`、`focusInput`、`input`、`commitText`、`delete`、`send`、`wait`、`message`、`time`、`scrollBottom`。
- 支持 `scriptBase64` 方式传入脚本，避免中文 JSON 在命令行中转义困难。
- 支持通过页面设置联系人昵称、头像、我的头像、聊天背景，并保存在 App 本地偏好中。
- 当前 UI 目标是“接近主流聊天 App 的体验”，但不直接复制微信品牌标识或受保护视觉元素。

### ADB 真实输入法点击脚本

- `tools/ime-tap-playback.ps1` 可以按坐标点击真实输入法。
- 支持九宫格布局和 26 键布局：`-Layout nine|qwerty`。
- 支持输入拼音按键序列：`-Keys "tianhuanle"`。
- 支持点击候选词：`-TapFirstCandidate`、`-CandidateIndex 1..5`。
- 支持“先展示真实按键动效，再用 App 脚本提交准确中文”的稳定方案：`-CommitText "中文" -SendAfterCommit`。
- 支持特殊 token，如 `{backspace}`、`{space}`、`{enter}`、`{symbol}`、`{comma}`、`{period}`、`{question}`、`{exclamation}`。
- 坐标目前按固定测试机校准，关键假设是手机分辨率约为 `1080x2400`，输入法布局位置不变。

### 本地 Web 控制台

- `console/server.js` 提供本地 HTTP 服务，默认端口 `5177`。
- 前端页面在 `console/public/`。
- 控制台用于让运营或测试人员用表单编排多条聊天动作。
- 当前支持三类消息：
  - 我方消息：点击真实输入法展示按键动效，再提交或发送文本。
  - 对方消息：直接通过 App 脚本插入聊天列表。
  - 按键动作：只点击真实键盘，用于展示退格、空格、符号等效果。
- 服务端会调用 `adb` 和 `tools/ime-tap-playback.ps1`。
- `console/package.json` 只依赖 `pinyin-pro`，用于从中文生成拼音按键序列。

## 4. 另一台电脑需要准备什么

### 必需环境

1. Windows + PowerShell。
2. Android Studio，建议可支持 Android Gradle Plugin `8.7.3`。
3. Android SDK Platform 35。
4. JDK，通常使用 Android Studio 自带 JDK 即可。
5. Node.js 和 npm，用于运行 `console`。
6. ADB，可来自 Android SDK Platform Tools。
7. 一台已开启 USB 调试的 Android 真机。
8. 真机上安装或切换到需要展示的输入法皮肤。

### 重要路径

当前代码里有默认 ADB 路径：

```text
D:\Develop\platform-tools\adb.exe
```

迁移后如果新电脑路径不同：

- 运行控制台前可设置环境变量 `ADB_PATH`。
- 或直接修改 `console/server.js` 顶部的默认 `ADB_PATH`。
- 单独运行 PowerShell 脚本时可传入 `-AdbPath "新路径\adb.exe"`，或修改 `tools/ime-tap-playback.ps1` 默认参数。

`local.properties` 里的 `sdk.dir` 是当前电脑本机路径，不要照搬依赖它。新电脑用 Android Studio 打开项目后会生成或更新自己的 `local.properties`。

## 5. 迁移时需要打包哪些内容

### 必须打包

```text
app/
console/package.json
console/package-lock.json
console/server.js
console/public/
tools/
svg/
andorid-device/
README.md
项目计划书.md
GPT交接文档.md
settings.gradle
build.gradle
```

### 可以一起打包，但不是必须

```text
app-current.png
screen-keyboard.png
screen-keyboard-device.png
```

这些是当前效果截图或调试参考图，对新 GPT 理解项目有帮助，但不影响代码运行。

### 不建议打包或不需要打包

```text
.gradle/
.idea/
app/build/
console/node_modules/
local.properties
```

原因：这些是本机缓存、IDE 配置、构建产物或本机 SDK 路径。新电脑应重新 Gradle Sync、重新 `npm install`。

### 推荐打包命令

在项目上级目录执行，生成一个干净迁移包：

```powershell
Compress-Archive -Path `
  .\XunfeiVideo\app,`
  .\XunfeiVideo\console\package.json,`
  .\XunfeiVideo\console\package-lock.json,`
  .\XunfeiVideo\console\server.js,`
  .\XunfeiVideo\console\public,`
  .\XunfeiVideo\tools,`
  .\XunfeiVideo\svg,`
  .\XunfeiVideo\andorid-device,`
  .\XunfeiVideo\README.md,`
  .\XunfeiVideo\项目计划书.md,`
  .\XunfeiVideo\GPT交接文档.md,`
  .\XunfeiVideo\settings.gradle,`
  .\XunfeiVideo\build.gradle,`
  .\XunfeiVideo\app-current.png,`
  .\XunfeiVideo\screen-keyboard.png,`
  .\XunfeiVideo\screen-keyboard-device.png `
  -DestinationPath .\XunfeiVideo-handoff.zip -Force
```

如果图片不存在或不想带图片，可以删掉最后三个图片路径。

## 6. 新电脑启动步骤

### Android App

1. 解压项目。
2. 用 Android Studio 打开项目根目录。
3. 等待 Gradle Sync。
4. 如提示缺 SDK，安装 Android SDK Platform 35 和对应 Build Tools。
5. 连接 Android 真机并开启 USB 调试。
6. 运行 `app`。

ADB 启动命令：

```bat
adb shell am start -n com.xunfei.video.showcase/.MainActivity
```

### Web 控制台

进入控制台目录：

```powershell
cd .\console
npm.cmd install
npm.cmd start
```

浏览器打开：

```text
http://127.0.0.1:5177
```

如果 ADB 不在默认路径，先设置：

```powershell
$env:ADB_PATH="C:\你的路径\platform-tools\adb.exe"
npm.cmd start
```

### 单独测试真实输入法点击

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ime-tap-playback.ps1 -AdbPath "C:\你的路径\adb.exe" -Layout qwerty -Keys "tianhuanle" -TapFirstCandidate -TapAppSend
```

更稳定的方式：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ime-tap-playback.ps1 -AdbPath "C:\你的路径\adb.exe" -Layout qwerty -Keys "jintianhuanleyigexindebizhi" -CommitText "今天换了一个新的壁纸" -SendAfterCommit
```

## 7. 当前已知限制和风险

1. 真实输入法坐标是按当前测试机写死的，换手机、换分辨率、换输入法布局后需要重新校准。
2. 目前还没有完整的视频生成流水线，只是跑通了 App、真实输入法点击和控制台编排。
3. 暂未实现稳定的录屏控制、自动拉取、FFmpeg 合成、字幕、BGM、TTS。
4. 控制台是本地原型，不是生产级任务系统，没有数据库、历史记录、权限和任务队列。
5. 当前项目不是 Git 仓库，迁移后建议初始化 Git，方便后续 GPT 修改和回滚。
6. `local.properties`、`.gradle`、`node_modules`、`app/build` 都是本机产物，不应作为核心源代码依赖。

## 8. 建议下一步做什么

建议另一个 GPT 按这个顺序继续：

1. 先在新电脑恢复运行环境：Android Studio 能运行 App，`adb devices` 能识别真机，控制台能打开。
2. 校准新手机的输入法坐标：确认九宫格、26 键、候选栏、发送按钮、输入框位置是否和旧机器一致。
3. 把硬编码坐标抽成设备配置文件，例如 `tools/device-profiles/1080x2400.json`。
4. 在控制台增加“设备检测”和“坐标校准/配置选择”功能，避免每次改脚本源码。
5. 增加录屏流程：`adb shell screenrecord` 开始录制、执行聊天脚本、停止录制、`adb pull` 拉取 MP4。
6. 增加任务结果目录，例如 `outputs/YYYYMMDD-HHMMSS/`，保存脚本 JSON、录屏、日志和最终视频。
7. 接入 FFmpeg 做最小合成：裁剪、加字幕、加 BGM、导出 1080p MP4。
8. 等单机流程稳定后，再考虑批量任务、素材库、AI 文案、TTS 和多设备并行。

## 9. 给另一个 GPT 的提示词

可以把下面这段直接发给另一台电脑上的 GPT：

```text
你现在接手的是 XunfeiVideo 项目，一个输入法皮肤展示视频自动化系统原型。请先阅读 README.md、项目计划书.md 和 GPT交接文档.md。

当前已经完成：Android 原生聊天演示 App、ADB JSON 脚本执行、真实输入法坐标点击脚本、本地 Web 控制台、多条聊天动作编排、中文转拼音按键序列、用 commitText 保证最终中文准确提交。

当前最重要的问题：换电脑和换手机后，需要恢复 Android/Node/ADB 环境，并重新校准真实输入法坐标。不要先做复杂 AI 或云端功能。

请优先做：1）确认项目能在新电脑运行；2）检查 ADB 路径和 local.properties；3）校准输入法坐标；4）把坐标从脚本硬编码抽成可配置设备 profile；5）再实现录屏、拉取和 FFmpeg 合成的最小闭环。
```

