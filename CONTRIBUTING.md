# 开发与发布

## 本地开发

使用 Windows x64、Python 3.11+、.NET Framework 4.8 和 Windows 10/11 SDK（蓝牙设备信息所需）。在仓库根目录执行：

```powershell
python build.py
.\runtime\node.exe scripts/test.mjs
python scripts/package.py
```

本机接口测试数据和打包产物写入 `.build/`。双击根目录的 `Micro Windows.exe` 启动桌面窗口。首次构建会下载并校验 Node.js、WebView2 SDK；首次打包准备 Inno Setup 编译器。

安装流程测试在干净 Windows 用户或 CI 上运行 `python scripts/verify-package.py`，验证安装、覆盖更新、卸载以及数据保留。脚本检测到已有安装时会停止。

界面测试需要 npm，执行 `npm ci --ignore-scripts` 和 `npx playwright install chromium`。设置 `MICRO_UI_ARTIFACTS` 为仓库外的绝对目录后运行：

```powershell
$env:MICRO_UI_ARTIFACTS = Join-Path $env:TEMP 'micro-ui-tests'
.\runtime\node.exe scripts/ui-smoke.mjs
.\runtime\node.exe scripts/ui-smoke.mjs --native
```

前者检查不同窗口大小和配置操作，后者运行独立数据目录中的 WebView2 桌面窗口，并验证隐藏、恢复与退出。`--ui-test` 仅用于模拟测试，正式启动不会启用模拟设备和调试端口。

提交前检查 `git diff`，保持改动围绕同一问题。修改设备写入、录入状态机或原生输入代码时，补充对应模拟测试；界面改动应核对桌面与窄屏显示。硬件相关的验证请在 PR 中说明所用模式和操作结果。

## 发新版

1. 更新 `package.json` 版本号，服务、页面、EXE 和安装包统一读取或使用构建生成的版本。
2. 在 `CHANGELOG.md` 顶部写明本版变化。
3. 执行构建、测试与打包核验。桌面更新须验证旧实例退出、未保存修改处理及配置兼容。
4. 将修改合入 `main`，确认 **CI** 成功。
5. 在 GitHub Actions 选择 **Release → Run workflow**，从 `main` 填写版本号，例如 `2.1.0`。

发布流程再次执行构建、接口及界面测试、安装核验，再创建 `v版本号` 标签和公开 Release，并附上 EXE 安装包与 SHA-256 文件。已经存在的 Release 不会被覆盖。

版本从 `CHANGELOG.md` 对应段落提取发布说明。历史标签用于保留原始版本，维护性改动提交到 `main`。

## 反馈问题

通过 Issue 提供程序版本、Windows 版本、键盘模式、复现步骤和实际结果。连接问题请附页面诊断文字；录入问题请描述按下与松开的顺序。
