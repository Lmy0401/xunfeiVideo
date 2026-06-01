# XunfeiVideo

输入法皮肤展示视频自动化系统原型。

## Android 演示 App

当前已创建最小 Android 原生工程，入口模块为 `app`。

第一版能力：

- 竖屏单聊界面
- 顶部聊天栏、消息区、底部输入区
- 使用真实 `EditText` 调起系统输入法
- 支持手动输入并发送消息
- 支持通过 ADB 传入 JSON 脚本并自动执行输入、等待、发送等动作
- 预置几条演示消息，方便录屏验证

界面目标是贴近主流聊天 App 的使用体验，但不直接复制微信品牌标识、图标或受保护视觉元素。

## 运行方式

1. 用 Android Studio 打开当前目录：`D:\Develop\Code\XunfeiVideo`
2. 等待 Gradle 同步完成
3. 连接已开启 USB 调试的 Android 测试机
4. 选择 `app` 配置并运行

如果 Android Studio 提示缺少 SDK，按提示安装 Android SDK Platform 35 和 Build Tools。

## ADB 启动命令

安装后也可以用 ADB 启动：

```bat
adb shell am start -n com.xunfei.video.showcase/.MainActivity
```

验证录屏：

```bat
adb shell screenrecord --time-limit 10 /sdcard/showcase_test.mp4
adb pull /sdcard/showcase_test.mp4 .
```

## 自动脚本

安装后可以通过 `script` extra 传入一份 JSON，让 App 自动执行聊天流程：

```bat
adb shell am start -n com.xunfei.video.showcase/.MainActivity --es script "{\"contact\":{\"name\":\"小夏\"},\"actions\":[{\"type\":\"clear\"},{\"type\":\"input\",\"text\":\"今天换了一个新的输入法皮肤\",\"speed\":120},{\"type\":\"wait\",\"duration\":800},{\"type\":\"send\"},{\"type\":\"message\",\"side\":\"other\",\"text\":\"看起来很清新\"},{\"type\":\"input\",\"text\":\"打字的时候还有动态效果\",\"speed\":100},{\"type\":\"send\"}]}"
```

支持的动作：

- `clear`：清空聊天记录
- `input`：逐字填入输入框，字段为 `text` 和 `speed`
- `delete`：从输入框删除字符，字段为 `count` 和 `speed`
- `wait`：等待，字段为 `duration`，单位毫秒
- `send`：发送当前输入框内容
- `message`：直接添加一条消息，可用 `side` 指定 `other` 或默认我方
- `time`：添加时间提示
- `scrollBottom`：滚动到聊天底部

脚本执行状态会输出到 logcat，标签为 `ShowcaseScript`：

```bat
adb logcat -s ShowcaseScript
```

## 真实输入法按键动效

如果视频必须展示真实输入法皮肤的按键动效，不能只用 App 内部的 `input` 动作，因为它是直接修改输入框文本，不会经过输入法按键。

第一版固定测试机可以使用桌面端 ADB 坐标点击脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ime-tap-playback.ps1 -Keys "tianhuanle" -TapFirstCandidate -TapAppSend
```

如果输入法切到 26 键布局，使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ime-tap-playback.ps1 -Layout qwerty -Keys "tianhuanle" -TapFirstCandidate -TapAppSend
```

如果要选择第 2 个候选词，使用 `-CandidateIndex`：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ime-tap-playback.ps1 -Layout qwerty -Keys "tianhuanle" -CandidateIndex 2 -TapAppSend
```

如果采用“真实按键动效 + 精准提交最终文本”的稳定方案，使用：

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\ime-tap-playback.ps1 -Layout qwerty -Keys "jintianhuanleyigexindebizhi" -CommitText "今天换了一个新的壁纸" -SendAfterCommit
```

这条命令会先点击真实输入法按键展示皮肤动效，然后通过 App 脚本接口把准确文本提交到输入框并发送，避免候选词选择错误。

使用前先确保：

- 手机分辨率为 `1080x2400`
- App 输入框已经聚焦
- 真实输入法已经弹出
- 输入法处于九宫格中文输入布局，或使用 `-Layout qwerty` 指定 26 键布局

脚本默认会先检测输入法是否已经弹出。如果没有弹出，会尝试启动 App 并聚焦输入框；如果仍未弹出，会点击当前测试机上的输入框位置。若你想跳过这个检查，可加 `-SkipEnsureIme`。

`-Keys` 传入的是要点击的拼音字母序列。脚本会点击真实输入法键盘坐标，因此录屏里可以看到皮肤按键反馈。`-TapFirstCandidate` 会点击候选栏第一项，`-CandidateIndex 2` 到 `-CandidateIndex 5` 可以选择指定候选词，`-CommitText` 可以在按键动效展示后提交准确中文，`-SendAfterCommit` 会通过 App 发送提交后的文本，`-TapAppSend` 会按坐标点击 App 的发送按钮。

这个脚本是当前测试机坐标版。后续如果要换手机、换键盘布局或批量生产，需要做键盘坐标校准或接入输入法内部调试接口。

## 本地可视化控制台

控制台用于把脚本参数做成界面。运营只需要填写发送内容、选择键盘布局和发送选项，系统会自动生成拼音按键序列并调用 ADB 回放脚本。

当前控制台支持按顺序编排多条聊天消息：

- 我方消息：点击真实输入法展示按键动效，再按配置提交或选择候选词并发送。
- 对方消息：不经过输入法，直接插入到聊天列表。
- 按键动作：只点击真实键盘，不发送消息，可用于展示退格、空格、符号等光标效果。
- 每条消息可以上移、下移、删除，用列表顺序控制聊天顺序。

按键动作支持普通字母和特殊 token，例如：

```text
{backspace}
{space}
{enter}
{symbol}
{comma}
{period}
{question}
{exclamation}
```

启动方式：

```powershell
cd D:\Develop\Code\XunfeiVideo\console
npm.cmd install
npm.cmd start
```

打开：

```text
http://127.0.0.1:5177
```

控制台默认使用：

```text
D:\Develop\platform-tools\adb.exe
```

如果 ADB 路径不同，可以启动前设置 `ADB_PATH` 环境变量。
