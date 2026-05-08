#!/bin/bash
# CC-Island Server 完整启动示例脚本
# 演示各种使用场景和配置方式

# ============================================
# 基础命令
# ============================================

# 查看帮助
echo "=== 查看帮助 ==="
cc-island-server --help

# 查看版本
echo "\n=== 查看版本 ==="
cc-island-server --version

# ============================================
# 配置管理（持久化）
# ============================================

# 查看当前配置
echo "\n=== 查看当前配置 ==="
cc-island-server config show

# 开启日志 + 云服务（持久保存）
echo "\n=== 配置云服务（持久保存） ==="
cc-island-server config set \
    --enable-logging \
    --cloud-mode \
    --cloud-server-url ws://cloud.example.com:17528 \
    --device-name my-server \
    --permission-timeout 300 \
    --ask-timeout 120 \
    --auto-deny-on-timeout

# 重置为默认配置
echo "\n=== 重置配置 ==="
cc-island-server config reset

# ============================================
# 启动方式
# ============================================

# 方式1：使用已保存的配置启动（推荐生产环境）
echo "\n=== 方式1：使用保存配置启动 ==="
# 先保存配置
cc-island-server config set \
    --enable-logging \
    --cloud-mode \
    --cloud-server-url ws://cloud.example.com:17528

# 然后启动（无需重复输入参数）
cc-island-server
# 按 Ctrl+C 停止

# 方式2：临时启动（参数不保存，推荐测试环境）
echo "\n=== 方式2：临时启动 ==="
cc-island-server run \
    --enable-logging \
    --cloud-mode \
    --cloud-server-url ws://cloud.example.com:17528

# 简写模式（默认run子命令）
cc-island-server \
    --enable-logging \
    --cloud-mode \
    --cloud-server-url ws://cloud.example.com:17528

# ============================================
# 配对信息（Mobile App）
# ============================================

# 查看完整配对信息（推荐）
echo "\n=== 查看配对信息 ==="
cc-island-server pair-info

# 仅查看 device token
echo "\n=== 仅查看 token ==="
cc-island-server device-token

# ============================================
# 生产环境部署脚本示例
# ============================================

# 完整生产部署流程
echo "\n=== 生产环境部署流程 ==="

# Step 1: 配置持久化
cc-island-server config set \
    --enable-logging \
    --cloud-mode \
    --cloud-server-url ws://cloud.example.com:17528 \
    --device-name production-server \
    --auto-deny-on-timeout

# Step 2: 验证配置
cc-island-server config show

# Step 3: 查看配对信息（用于 Mobile App）
cc-island-server pair-info

# Step 4: 启动服务（后台运行）
# 使用 nohup 或 systemd 管理后台进程
nohup cc-island-server > /var/log/cc-island-server.log 2>&1 &

# 或使用 systemd service（推荐）
# systemctl start cc-island-server

# ============================================
# systemd service 配置示例
# ============================================

# /etc/systemd/system/cc-island-server.service
cat << 'EOF'
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

# 环境变量（可选）
Environment="RUST_LOG=info"

# 日志
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# ============================================
# Docker 部署示例
# ============================================

# 使用 musl 静态二进制（无依赖）
cat << 'EOF'
FROM alpine:latest

# 复制静态二进制
COPY cc-island-server-x86_64-musl /usr/local/bin/cc-island-server
RUN chmod +x /usr/local/bin/cc-island-server

# 创建配置目录
RUN mkdir -p /root/.cc-island

# 暴露端口（可选，仅用于 HTTP server mode）
EXPOSE 17527

# 启动
CMD ["cc-island-server"]
EOF

# ============================================
# 参数优先级说明
# ============================================

echo "\n=== 参数优先级 ==="
echo "run 子命令:       CLI参数 > 配置文件 > 默认值 (临时，不保存)"
echo "config set:       CLI参数直接保存 (永久)"
echo "无子命令:         等同于 run (临时)"

# ============================================
# 常见场景示例
# ============================================

# 场景1：测试临时配置
echo "\n=== 场景1：测试云连接 ==="
cc-island-server run \
    --cloud-mode \
    --cloud-server-url ws://test-server:17528

# 场景2：永久启用日志
echo "\n=== 场景2：永久启用日志 ==="
cc-island-server config set --enable-logging
cc-island-server

# 场景3：本地调试（无云服务）
echo "\n=== 场景3：本地调试 ==="
cc-island-server run \
    --enable-logging \
    --no-cloud-mode

# 场景4：快速配对
echo "\n=== 场景4：快速配对 ==="
cc-island-server pair-info
# 输出 token 和 server URL，用于 Mobile App 配对
EOF