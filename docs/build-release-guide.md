# Build & Release Guide

本文档介绍 CC-Island 各组件的构建和发布流程。

## 构建产物

| 组件 | 平台 | 产物格式 |
|------|------|---------|
| Desktop App | macOS (ARM) | `.dmg` |
| Desktop App | macOS (Intel) | `.dmg` |
| Desktop App | Windows | `.msi`, `.exe` |
| Desktop App | Linux | `.deb`, `.AppImage` |
| Cloud Server | Linux x86_64 | `.tar.gz` |
| Cloud Server | Linux ARM64 | `.tar.gz` |
| Mobile App | Android | `.apk` |
| Mobile App | iOS | TestFlight (内部分发) |

## GitHub Actions Workflow

### 触发方式

1. **标签发布**: 推送 `v*` 标签自动触发
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

2. **手动触发**: GitHub Actions 页面 → Run workflow

### 构建流程

所有构建 Job 并行执行：

```
build-cloud-server (Linux x86_64 + ARM64)
build-desktop (macOS + Windows + Linux)
build-mobile-android
build-mobile-ios (TestFlight)
    ↓
release (创建 GitHub Release)
```

### Required Secrets

| Secret | 组件 | 说明 |
|--------|------|------|
| `FASTLANE_APPLE_ID` | iOS | Apple ID 邮箱 |
| `FASTLANE_APPLE_PASSWORD` | iOS | App-Specific Password |
| `FASTLANE_TEAM_ID` | iOS | Team ID |

> iOS 构建需要配置以上 Secrets，否则 iOS Job 会跳过执行。

## 各组件构建说明

### Desktop App

基于 Tauri 2.x 构建，使用 GitHub Actions 自动编译各平台版本。

**本地开发构建:**
```bash
pnpm install
pnpm tauri:dev
```

**本地生产构建:**
```bash
pnpm tauri:build
```

### Cloud Server

基于 Rust + Tokio + Axum 的 WebSocket 服务器。

**本地构建:**
```bash
cd cloud-server
cargo build --release
```

**部署步骤:**
1. 解压发布包: `tar -xzf cc-island-cloud_*.tar.gz`
2. 启动 PostgreSQL: `docker-compose up -d`
3. 配置 `.env` 文件 (参考 `.env.example`)
4. 运行: `./cc-island-cloud`

### Mobile App (Android)

基于 Capacitor + React 的移动应用。

**本地构建:**
```bash
cd mobile-app
pnpm install
pnpm run build
npx cap sync android
npx cap open android  # 打开 Android Studio
```

**APK 构建:**
```bash
cd mobile-app/android
./gradlew assembleRelease
```

APK 位于: `mobile-app/android/app/build/outputs/apk/release/`

### Mobile App (iOS)

详细配置见 [ios-build-setup.md](./ios-build-setup.md)。

**本地构建:**
```bash
cd mobile-app
pnpm install
pnpm run build
npx cap sync ios
npx cap open ios  # 打开 Xcode
```

**TestFlight 上传:**
```bash
cd mobile-app/ios/App
bundle install
bundle exec fastlane ios beta
```

## 版本管理

版本号在以下文件中同步更新：

| 文件 | 当前版本 |
|------|---------|
| `package.json` | 0.2.0 |
| `src-tauri/Cargo.toml` | 0.2.0 |
| `src-tauri/tauri.conf.json` | 0.2.0 |
| `cloud-server/Cargo.toml` | 0.2.0 |
| `mobile-app/package.json` | 0.2.0 |

**更新版本:**
```bash
# 同时更新所有文件
# package.json
# src-tauri/Cargo.toml
# src-tauri/tauri.conf.json
# cloud-server/Cargo.toml
# mobile-app/package.json
```

## Release Notes 格式

GitHub Release 自动生成 Changelog，格式配置在 `.github/changelog-configuration.json`。

发布说明包含：
- Desktop App 下载说明
- Cloud Server 部署说明
- Mobile App 安装说明

## 相关文档

- [iOS Build Setup](./ios-build-setup.md) - iOS TestFlight 配置详细步骤