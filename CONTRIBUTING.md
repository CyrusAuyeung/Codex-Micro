# 开发与发布

## 本地开发

使用 Windows x64、Python 3.11+ 和系统 .NET Framework 4.x。在仓库根目录执行：

```powershell
python build.py
.\runtime\node.exe scripts/test.mjs
python scripts/package.py
python scripts/verify-package.py
```

本机测试数据和打包产物写入 `.build/`。运行界面时双击根目录的 `Micro Windows.exe`。

提交前检查 `git diff`，保持改动围绕同一问题。修改设备写入、录入状态机或原生输入代码时，补充对应模拟测试；界面改动应核对桌面与窄屏显示。硬件相关的验证请在 PR 中说明所用模式和操作结果。

## 发新版

1. 更新 `package.json`、`server.mjs` 的版本号以及 `public/hardware.html` 的显示版本。
2. 同步 `native/Launcher.cs` 的当前服务版本、当前版本互斥量和旧版本退出逻辑。确保旧程序能够正确退出，新版能够接续启动。
3. 在 `CHANGELOG.md` 顶部写明本版变化，执行本地构建、测试与打包核验。
4. 将修改合入 `main`，确认 **CI** 成功。
5. 在 GitHub Actions 选择 **Release → Run workflow**，从 `main` 填写版本号，例如 `1.1.7`。

发布流程再次执行构建、测试和解压核验，再创建 `v版本号` 标签和公开 Release，并附上 Windows ZIP 与 SHA-256 文件。已经存在的 Release 不会被覆盖。

版本从 `CHANGELOG.md` 对应段落提取发布说明。历史标签用于保留原始版本，维护性改动提交到 `main`。

## 反馈问题

通过 Issue 提供程序版本、Windows 版本、键盘模式、复现步骤和实际结果。连接问题请附页面诊断文字；录入问题请描述按下与松开的顺序。
