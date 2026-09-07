# Micro Windows

<img src="public/micro.svg" width="72" alt="Micro Windows 图标">

Codex Micro 复刻键盘的 Windows 桌面配置工具。按实体布局选择键位，将普通模式的快捷键保存进键盘；也可以在 Codex 模式下，把按键、旋钮和摇杆动作映射为 Windows 功能。

[下载最新版](https://github.com/CyrusAuyeung/Codex-Micro/releases/latest) · [所有版本](https://github.com/CyrusAuyeung/Codex-Micro/releases) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/CyrusAuyeung/Codex-Micro/issues/new/choose)

## 安装与启动

1. 在 Release 的 **Assets** 中下载 `Micro-Windows-版本号-Setup-x64.exe`。
2. 运行安装包，完成当前 Windows 用户的安装。
3. 从开始菜单或桌面快捷方式打开 **Micro Windows**，进入独立配置窗口。

适用系统：**Windows 10 2004 或更新版本 / Windows 11 x64**，使用 .NET Framework 4.8。轻量安装包自带 Node.js，窗口使用 Microsoft WebView2；电脑缺少 WebView2 时，安装程序会联网补装。安装完成后的键位配置无需互联网。

关闭窗口后程序留在系统托盘，双击托盘图标恢复窗口，右键选择“退出”可彻底退出。重复启动会恢复已有窗口。

发现新版时，“关于”旁会显示提示。点击 **下载安装包**，运行下载的文件完成覆盖安装。已有键位配置和备份会保留，卸载程序也会保留这些数据。

适用键盘：同款 Codex Micro 复刻版，顶部旋钮与摇杆、13 颗按键，底排为触摸点和三颗并排小键。

## 两种配置方式

| | 普通键盘 · 保存到设备 | Codex 模式 · 本机改键 |
|---|---|---|
| 配置时连接 | `Codex Micro Config` Wi-Fi | 蓝牙 `Codex Micro` |
| 使用时模式 | 蓝灯普通模式，蓝牙 `Codex Micro KB` | 青灯 Codex 模式 |
| 设置保存位置 | 键盘 | 当前 Windows 用户 |
| 程序运行要求 | 写入并核对后可以退出 | 保留托盘程序运行，窗口可以关闭 |
| 配置内容 | 固件开放的普通键位与旋钮按下 | 按键、旋钮和摇杆上报的动作 |

## 将快捷键保存进键盘

1. 长按左下触摸点，灯变红时松开，进入 **Config 配置模式**。
2. 让这台电脑连接 **Codex Micro Config** Wi-Fi，确认能够访问 `http://192.168.4.1/`。需要同时上网时，可保留网线或另一条网络通道。
3. 在程序的“普通键盘”页点击 **读取键盘**。
4. 在俯视图中选择实体按键，使用预设、手动选择或 **录入组合键** 设置快捷键。
5. 查看修改预览，确认后写入。程序会保存写入前的配置备份。
6. 按页面提示重新读取并核对。键盘若重启，需要重新进入 Config 模式并连接热点。
7. 核对成功后回到蓝灯普通模式，通过蓝牙连接 **Codex Micro KB** 使用。

页面支持导入、导出配置草稿。要导入并写入现有配置，先读取键盘，再导入文件、预览并保存。连接说明和诊断分别位于顶部的 **帮助** 与 **连接诊断**。

## 快捷键录入

点击“录入组合键”，等拦截就绪后按键。录入期间会实时显示组合，避免 `Alt + A` 等已有快捷键直接唤起其他软件。

- **替换主键**：按 `Alt + A`，松开 A 时仍显示 `Alt + A`；保持 Alt，再按 B，显示更新为 `Alt + B`。
- **单个或多个修饰键**：支持 `Alt`、`Ctrl + Alt`，主键可以为空。
- **反复试按**：全部松开后保留候选组合，可以继续试按；点击 **使用此组合** 才完成录入。
- **调整修饰键**：修改修饰键后重新按主键，得到新的完整组合。松开的先后顺序不会拆散已经录入的组合。

## Codex 本机改键与旋钮

1. 切到青灯 Codex 模式，在 Windows 蓝牙设置中连接 **Codex Micro**。
2. 打开“Codex 模式”页，选择实体位置，点击识别并操作对应按键。
3. 选择要执行的 Windows 功能，应用到该位置，再启用 Windows 自定义。

旋钮按下、顺时针、逆时针以及摇杆方向可分别识别和绑定，具体取决于键盘在 Codex 模式下上报的动作。常用功能包括组合键、音量和媒体控制。

## 常见问题

**为什么普通模式没有旋钮顺逆时针的保存项？**

当前固件的普通键位接口提供 16 个配置位，界面按 13 颗实体按键和旋钮按下呈现，其余两项在“其他配置位”中查看。旋转方向和摇杆方向需要固件提供对应的写入接口；目前可在 Codex 本机改键中配置。

**为什么没有 Fn 录入？**

多数键盘的 Fn 由键盘固件处理，Windows 收不到独立按键事件。可录入 Ctrl、Shift、Alt、Win 及其组合；系统保留的 `Ctrl + Alt + Delete` 也无法由普通应用拦截。

**连接热点后显示“无 Internet”，或读取失败？**

配置热点本身用于访问键盘。先打开原厂地址 `http://192.168.4.1/`，再点击 **连接诊断 → 检查连接** 查看热点、IP 分配和设备响应。如果提示 DHCP 未分配地址，按诊断结果使用临时连接修复；需要时 Windows 会请求管理员权限。

**是否需要一直开着窗口？**

普通模式的设置经写入和核对后保存在键盘中，程序可以退出。Codex 本机改键由托盘程序执行，关闭窗口后仍可使用，退出托盘程序后停止。

**设置和备份在哪里？**

`%LOCALAPPDATA%\Micro Windows\` 中的 `bindings.json` 保存本机映射，`backups` 保存其备份，`device-config\backups` 保存键盘写入前的配置。排查启动问题可查看同目录的 `panel.log`。

## 源码与构建

JavaScript 服务使用 Node.js 内置模块，桌面窗口使用 C# WinForms 与 WebView2。准备 Windows x64、.NET Framework 4.8 和 Python 3.11+，在仓库根目录执行：

```powershell
python build.py
.\runtime\node.exe scripts/test.mjs
python scripts/package.py
```

构建脚本下载并校验指定版本的 Node.js 与 WebView2 SDK，再编译四个 EXE 并运行原生自检。打包使用 Inno Setup 7.1.0，首次打包时准备编译器。已有同版本 Node.js 可通过环境变量 `MICRO_NODE_SOURCE` 指定文件，仍会校验 SHA-256。

安装包与 `SHA256SUMS.txt` 位于 `.build/release/`。`python scripts/verify-package.py` 在独立目录验证安装、覆盖更新和卸载，并检查配置保留；检测到当前用户已安装本程序时会停止，适合在干净测试用户或 CI 中执行。

界面测试使用 Playwright 和模拟设备，覆盖首屏布局、快捷键录入、保存回读及桌面窗口生命周期。运行方式见 [开发与发布](CONTRIBUTING.md)。

| 路径 | 内容 |
|---|---|
| `public/` | 两种配置页面、实体布局和录入交互 |
| `server.mjs`、其他根目录 `.mjs` | 本地服务、设备映射、输入和网络适配 |
| `native/` | 启动器、HID、网络和组合键拦截辅助程序 |
| `assets/` | Windows 图标与图标生成脚本 |
| `installer/` | 当前用户安装、WebView2 补装和卸载流程 |
| `tests/` | 单元测试、接口测试和模拟设备 |
| `scripts/` | 运行时准备、版本检查、打包和发布工具 |
| `.github/workflows/` | Windows 持续集成与手动发布流程 |

## 版本与发布

历史 **1.x** 的源码快照和便携 ZIP 保留在对应 `v` 标签与 Release 中。从 **2.0.0** 起提供独立桌面窗口和 EXE 安装包。`main` 用于后续开发。

新版本通过 GitHub Actions 的 **Release → Run workflow** 手动发布。填写与源码一致的版本号，流程完成构建、测试、打包和核验后创建标签并发布下载包。具体修改与发布步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[MIT](LICENSE)。适用范围与随包组件的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
