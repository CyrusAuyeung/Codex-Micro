# 许可范围与第三方组件

本仓库的 MIT 许可适用于维护者有权授权的新增及修改代码。部分既有界面资源与设备协议适配代码随原始资源提供时未附许可信息；MIT 不改变这些部分原有的权利状态。

程序包内的 Node.js 运行时及其依赖组件分别适用其原有许可，完整声明见 [runtime/LICENSE.node.txt](runtime/LICENSE.node.txt)。再分发程序包时请保留这些许可文件。

桌面窗口使用 Microsoft WebView2 SDK 1.0.4191.47，SDK 许可随程序提供于 `runtime/LICENSE.webview2.txt`。WebView2 Evergreen Runtime 由 Microsoft 单独提供并更新，安装程序仅在缺少运行时的情况下调用 Microsoft 官方引导程序。

安装包使用 Inno Setup 7.1.0 构建，项目及其许可见 https://github.com/jrsoftware/issrc 。
