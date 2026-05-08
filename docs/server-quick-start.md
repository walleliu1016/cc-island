# CC-Island Server 快速启动指南

## 一、快速测试（临时启动）

```bash
# 临时启动（参数不保存，适合测试）
cc-island-server --enable-logging --cloud-mode --cloud-server-url ws://your-server:17528
```

## 二、生产部署（持久配置）

### Step 1: 配置持久化

```bash
# 永久保存配置
cc-island-server config set \
    --enable-logging \
    --cloud-mode \
    --cloud-server-url ws://your-server:17528 \
    --device-name production-server
```

### Step 2: 验证配置

```bash
# 查看已保存配置
cc-island-server config show
```

### Step 3: 获取配对信息

```bash
# 查看完整配对信息（用于 Mobile App）
cc-island-server pair-info
```

输出示例：
```
CC-Island Pairing Information
==============================
Device Token: d8ba913a09bf93daaf73dfe78d2de4ae
Device Name:  production-server
Server URL:   ws://your-server:17528
✓ Cloud mode enabled and server configured

使用方法：
1. 在 Mobile App Settings 中点击 '+' 添加设备
2. 输入 Device Token
3. 输入 Server URL
```

### Step 4: 启动服务

```bash
# 直接启动（使用已保存配置）
cc-island-server

# 按 Ctrl+C 停止
```

## 三、后台运行（systemd）

### 创建 systemd service

```bash
# 创建服务文件
sudo nano /etc/systemd/system/cc-island-server.service
```

内容：
```ini
[Unit]
Description=CC-Island Server (Background Mode)
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/opt/cc-island
ExecStart=/opt/cc-island/cc-island-server
Restart=on-failure
RestartSec=5
Environment="RUST_LOG=info"
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 启动服务

```bash
# 加载服务
sudo systemctl daemon-reload

# 启动
sudo systemctl start cc-island-server

# 查看状态
sudo systemctl status cc-island-server

# 查看日志
sudo journalctl -u cc-island-server -f

# 停止
sudo systemctl stop cc-island-server
```

## 四、Docker 部署

### Dockerfile

```dockerfile
FROM alpine:latest

# 复制 musl 静态二进制
COPY cc-island-server-x86_64-musl /usr/local/bin/cc-island-server
RUN chmod +x /usr/local/bin/cc-island-server

# 创建配置目录
RUN mkdir -p /root/.cc-island

# 启动
CMD ["cc-island-server"]
```

### 构建和运行

```bash
# 构建镜像
docker build -t cc-island-server .

# 运行容器
docker run -d \
    --name cc-island-server \
    --restart unless-stopped \
    -v ~/.cc-island:/root/.cc-island \
    cc-island-server

# 查看日志
docker logs -f cc-island-server
```

## 五、常用命令速查

| 命令 | 说明 |
|------|------|
| `cc-island-server --help` | 查看帮助 |
| `cc-island-server config show` | 查看配置 |
| `cc-island-server config set --cloud-mode` | 永久启用云服务 |
| `cc-island-server run --cloud-mode` | 临时启用云服务 |
| `cc-island-server pair-info` | 查看配对信息 |
| `cc-island-server device-token` | 仅显示 token |
| `cc-island-server config reset` | 重置配置 |

## 六、参数优先级

| 子命令 | 优先级 | 持久化 |
|--------|--------|--------|
| `run` | CLI > config > defaults | ❌ 不保存 |
| `config set` | CLI直接保存 | ✅ 永久 |
| 无子命令 | 等同于 `run` | ❌ 不保存 |

## 七、完整参数列表

```bash
--enable-logging              启用日志
--no-enable-logging           禁用日志
--cloud-mode                  启用云服务
--no-cloud-mode               禁用云服务
--cloud-server-url <URL>      云服务器地址
--device-name <NAME>          设备名称
--permission-timeout <SECS>   权限超时（默认300）
--ask-timeout <SECS>          Ask超时（默认120）
--auto-deny-on-timeout        超时自动拒绝
--no-auto-deny-on-timeout     禁用超时自动拒绝
--auto-allow-permissions      自动允许权限
--no-auto-allow-permissions   禁用自动允许
--poll-interval <MS>          轮询间隔（默认500）
--max-instances <N>           最大实例数（默认10）
--max-popup-queue <N>         最大弹出队列（默认5）
```

---

**注意事项：**
- 配置文件位置：`~/.cc-island/settings.json`
- musl静态二进制无依赖，适合Alpine/容器部署
- systemd/Docker部署需先使用 `config set` 保存配置