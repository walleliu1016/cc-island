# iOS Build Setup Guide

本文档介绍如何配置 iOS 构建和 TestFlight 内部分发。

## Prerequisites

- Apple Developer 账号 ($99/年)
- Bundle ID: `com.ccisland.remote` (已在 capacitor.config.ts 配置)
- App Store Connect 中创建 App

## 1. 创建 App-Specific Password

为 GitHub Actions 创建专用密码：

1. 访问 [appleid.apple.com](https://appleid.apple.com)
2. 登录 Apple ID
3. 安全 → App-Specific Passwords
4. 点击 "生成密码"
5. 输入标签: `GitHub Actions`
6. 复制生成的密码 (格式: `xxxx-xxxx-xxxx-xxxx`)

## 2. 获取 Team ID

1. 访问 [developer.apple.com](https://developer.apple.com)
2. 登录后点击右上角账号名
3. Membership → Team ID
4. Team ID 格式为 10 位字母，如: `ABC123XYZ`

## 3. 在 App Store Connect 创建 App

首次构建需要在 App Store Connect 创建 App：

1. 访问 [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. My Apps → 点击 "+" → New App
3. 填写信息：
   - **Name**: CC-Island Remote
   - **Primary Language**: Chinese Simplified
   - **Bundle ID**: com.ccisland.remote
   - **SKU**: ccisland-remote (任意唯一标识)

## 4. 配置 GitHub Secrets

在 GitHub 仓库设置中添加 Secrets：

1. 进入 GitHub 仓库
2. Settings → Secrets and variables → Actions
3. 点击 "New repository secret"

添加以下 Secrets：

| Secret 名称 | 值 | 说明 |
|------------|---|------|
| `FASTLANE_APPLE_ID` | `your-email@example.com` | Apple Developer 账号邮箱 |
| `FASTLANE_APPLE_PASSWORD` | `xxxx-xxxx-xxxx-xxxx` | App-Specific Password |
| `FASTLANE_TEAM_ID` | `ABC123XYZ` | Apple Developer Team ID |

## 5. TestFlight 内部分发配置

### 5.1 添加内部测试人员

1. App Store Connect → 选择 App
2. TestFlight → Internal Testing
3. 点击 "Add Internal Testers"
4. 输入团队成员 Apple ID 邮箱
5. 最多可添加 100 名内部测试人员

### 5.2 测试人员安装步骤

测试人员收到邀请后：

1. iPhone 安装 TestFlight app (从 App Store 搜索安装)
2. 查收邮件邀请
3. 点击邀请链接加入测试
4. 在 TestFlight 中安装 CC-Island Remote

## 6. 触发构建

推送标签触发 GitHub Actions 构建：

```bash
git checkout main
git merge feature/websocket-remote
git tag v0.2.0
git push origin main --tags
```

构建完成后：
- iOS IPA 自动上传到 TestFlight
- 测试人员可通过 TestFlight app 安装

## 7. 文件结构

iOS 构建相关文件：

```
mobile-app/ios/App/
├── Gemfile              # Ruby 依赖 (fastlane, cocoapods)
├── fastlane/
│   ├── Appfile          # App 配置 (Bundle ID, Team ID)
│   └── Fastfile         # 构建脚本 (beta lane)
```

### Fastfile 内容

```ruby
platform :ios do
  desc "Build and upload to TestFlight"
  lane :beta do
    # Build IPA
    gym(
      workspace: "App.xcworkspace",
      scheme: "App",
      configuration: "Release",
      export_method: "app-store",
      output_directory: "./build",
      output_name: "App.ipa"
    )

    # Upload to TestFlight
    upload_to_testflight(
      skip_waiting_for_build_processing: true,
      notify_external_teams: false
    )
  end
end
```

## 8. Troubleshooting

### 构建失败: "No signing certificate"

确保：
1. Apple Developer 账号有效
2. Team ID 正确
3. App-Specific Password 有效

### 上传失败: "App not found"

确保：
1. App Store Connect 中已创建 App
2. Bundle ID 与 capacitor.config.ts 一致 (`com.ccisland.remote`)

### TestFlight 邀请未收到

检查：
1. 测试人员 Apple ID 已添加到 Internal Testing
2. 测试人员 Apple ID 与邮件地址一致

## Alternative: Manual Build (本地构建)

如需本地调试 iOS 构建：

```bash
cd mobile-app
pnpm install
pnpm run build
npx cap sync ios
npx cap open ios  # 打开 Xcode
```

在 Xcode 中：
1. 选择项目 → Signing & Capabilities
2. 选择 Team
3. Build → Archive → Distribute App