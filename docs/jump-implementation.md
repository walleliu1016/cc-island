# Jump 功能实现方案

## 功能目标

点击 CC-Island 实例后，激活对应的终端窗口并置于前台。

## 核心流程

```
SessionStart Hook → 查找 Claude 进程 → 追溯进程树 → 识别终端类型/PID → 存储 ProcessInfo
                                           ↓
                              用户点击 Jump → 根据终端类型激活窗口
```

## 平台实现方案

### macOS

| 终端 | 激活方法 | 状态 |
|------|---------|------|
| Terminal.app | `osascript -e 'tell app "Terminal" to activate'` | ✅ 已实现 |
| iTerm2 | `osascript -e 'tell app "iTerm2" to activate'` | ✅ 已实现 |
| Alacritty | AppleScript + PID 或应用名 | ✅ 已实现 |
| VSCode | `tell app "Visual Studio Code" to activate` | ✅ 已实现 |
| 其他 | AppleScript 通过 PID 激活 | ✅ 已实现 |

**通用方案（通过 PID）：**
```applescript
tell application "System Events"
    set frontmost of first process whose unix id is <PID> to true
end tell
```

### Windows

| 终端 | 进程名 | 激活方法 |
|------|--------|---------|
| Windows Terminal | `WindowsTerminal.exe`, `wt.exe` | Win32 API `SetForegroundWindow` |
| PowerShell | `powershell.exe` | Win32 API |
| CMD | `cmd.exe` → `conhost.exe` | 通过父进程找到 console host |
| Git-Bash | `mintty.exe`, `bash.exe` | Win32 API |

**技术方案：**

1. **Win32 API 方案（推荐）**
```rust
use winapi::um::winuser::SetForegroundWindow;
use winapi::um::winuser::GetForegroundWindow;
use winapi::shared::windef::HWND;

// 获取进程主窗口句柄并激活
fn activate_window_by_pid(pid: u32) -> bool {
    // EnumWindows 找到属于该 PID 的窗口
    // SetForegroundWindow 激活窗口
}
```

2. **PowerShell 方案（备选）**
```powershell
# 通过 WMI 获取窗口句柄
Get-Process -Id <PID> | ForEach-Object {
    (New-Object -ComObject WScript.Shell).AppActivate($_.MainWindowTitle)
}
```

3. **进程追溯逻辑**
```
claude.exe/node.exe → powershell/cmd/bash → parent → WindowsTerminal/conhost
```

### Linux

| 终端 | 进程名 | 激活方法 |
|------|--------|---------|
| gnome-terminal | `gnome-terminal-server` | `xdotool` 或 `wmctrl` |
| konsole | `konsole` | `xdotool` 或 `wmctrl` |
| Alacritty | `alacritty` | `xdotool` 或 `wmctrl` |

**技术方案：**

1. **xdotool 方案（推荐）**
```bash
# 通过 PID 找窗口并激活
xdotool search --pid <terminal_pid> windowactivate

# 通过窗口类名激活
xdotool search --onlyvisible --class "gnome-terminal" windowactivate
```

2. **wmctrl 方案（备选）**
```bash
# 通过窗口标题激活
wmctrl -a "Terminal"

# 通过窗口 ID 激活
wmctrl -i -a <window_id>
```

3. **进程追溯逻辑**
```
claude/node → bash/zsh → gnome-terminal-server/konsole/alacritty
```

## 终端进程名识别表

| 平台 | 终端 | 进程名特征 |
|------|------|-----------|
| macOS | Terminal | `Terminal.app` |
| macOS | iTerm2 | `iTerm`, `iTerm2` |
| macOS | Alacritty | `alacritty` |
| macOS | VSCode | `electron`, `Code` |
| Windows | Windows Terminal | `WindowsTerminal`, `wt` |
| Windows | PowerShell | `powershell` |
| Windows | CMD | `cmd` → `conhost` |
| Windows | Git-Bash | `mintty`, `bash` |
| Linux | gnome-terminal | `gnome-terminal` |
| Linux | konsole | `konsole` |
| Linux | Alacritty | `alacritty` |

## 文件结构

```
src-tauri/src/platform/
├── mod.rs           # 统一入口 + cfg 条件编译分发
├── macos.rs         # macOS 实现 (AppleScript)
├── windows.rs       # Windows 实现 (Win32 API)
└── linux.rs         # Linux 实现 (xdotool/wmctrl)
```

## 依赖项

### Cargo.toml

```toml
# Windows
[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3", features = ["winuser", "processthreadsapi"] }

# Linux (可选，运行时检测工具是否存在)
# xdotool 和 wmctrl 通过外部命令调用，无需 Rust 依赖
```

### 系统要求

- **Linux**: 需安装 `xdotool` 或 `wmctrl`
  ```bash
  # Ubuntu/Debian
  sudo apt install xdotool wmctrl

  # Fedora
  sudo dnf install xdotool wmctrl
  ```