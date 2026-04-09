# CC-Island 用户指南

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="CC-Island Logo" width="128" height="128">
</p>

CC-Island 是一款桌面应用，帮助你同时管理多个 Claude Code 会话。它会在屏幕顶部显示一个类似 iOS 灵动岛的小窗口，实时显示所有 Claude 实例的状态。

---

## 安装

### 下载

从 [GitHub Releases](https://github.com/walleliu1016/cc-island/releases) 页面下载适合你系统的版本：

| 系统 | 文件格式 |
|------|----------|
| macOS (M1/M2/M3) | `.dmg` |
| macOS (Intel) | `.dmg` |
| Windows | `.exe` |
| Linux | `.AppImage` 或 `.deb` |

### 系统要求

- **macOS**: 10.15 (Catalina) 或更高版本
- **Windows**: Windows 10 或更高版本
- **Linux**: 主流发行版

---

## 快速开始

### 第一步：启动 CC-Island

双击打开应用。首次启动时，CC-Island 会自动完成所有配置：

1. 创建必要的配置文件
2. 设置 Claude Code 的 hook 连接

你会在屏幕顶部中央看到一个小的胶囊形状窗口。

### 第二步：启动 Claude Code

正常启动你的 Claude Code 会话。CC-Island 会自动检测并显示所有运行中的实例。

---

## 界面说明

### 胶囊窗口

应用启动后，屏幕顶部会显示一个紧凑的胶囊窗口：

```
● 3 Claude · 2 idle · 1 working
```

这里显示：
- 当前运行的 Claude 实例总数
- 各状态的实例数量

### 展开视图

将鼠标移动到胶囊窗口上，会展开显示详细信息：

- **实例列表**：所有 Claude 会话及其当前状态
- **操作按钮**：每个实例旁有 Jump 按钮，点击可跳转到对应终端

---

## 状态说明

CC-Island 会显示以下状态：

| 状态 | 图标 | 含义 |
|------|------|------|
| 正在执行 | ⚡ | Claude 正在执行工具命令 |
| 等待权限 | 🔐 | 需要你允许或拒绝某个操作 |
| 等待回答 | 💬 | Claude 正在等待你的回答 |
| 等待输入 | 💭 | Claude 正在等待你输入问题 |
| 等待响应 | ⏳ | 正在等待 AI 回复 |
| 会话结束 | 🏁 | 会话已终止 |

---

## 常用操作

### 响应权限请求

当 Claude 想要执行敏感操作（如删除文件）时：

1. CC-Island 会自动展开显示权限请求
2. 显示请求的操作内容
3. 点击 **Allow** 允许，或点击 **Deny** 拒绝

### 回答问题

当 Claude 向你提问时：

1. 窗口自动展开显示问题
2. 选择选项或输入回答
3. 提交后继续

### 跳转到终端

想查看某个 Claude 会话的终端窗口：

1. 将鼠标移到胶囊窗口展开列表
2. 找到目标实例
3. 点击 **Jump** 按钮

---

## 系统托盘

CC-Island 会在系统托盘区域显示图标：

- **点击托盘图标**：显示菜单
- **退出**：点击菜单中的"退出"关闭应用

---

## 常见问题

### 启动 Claude Code 后窗口没有显示实例？

请确认：
1. CC-Island 正在运行（检查系统托盘）
2. 等待几秒钟让检测生效

### macOS 跳转功能不起作用？

需要授予辅助功能权限：

1. 打开 **系统偏好设置** → **安全性与隐私** → **隐私**
2. 选择左侧的 **辅助功能**
3. 点击左下角锁图标解锁
4. 将 CC-Island 添加到列表并勾选

### 权限请求超时会怎样？

- 权限请求默认等待 5 分钟
- 超时后会自动拒绝该请求
- 建议及时响应窗口中的提示

### 如何重新配置？

如果配置出现问题，可以重置：

1. 关闭 CC-Island
2. 删除 `~/.cc-island/.initialized` 文件
   - macOS/Linux: 打开终端，运行 `rm ~/.cc-island/.initialized`
   - Windows: 删除用户目录下 `.cc-island` 文件夹中的 `.initialized` 文件
3. 重新启动 CC-Island

---

## 隐私说明

CC-Island 仅在本地运行：

- 所有数据存储在你本地的 `~/.cc-island/` 目录
- 不会向任何外部服务器发送数据
- 不会收集任何使用信息

---

## 获取帮助

- **问题反馈**: [GitHub Issues](https://github.com/walleliu1016/cc-island/issues)
- **查看源码**: [GitHub Repository](https://github.com/walleliu1016/cc-island)