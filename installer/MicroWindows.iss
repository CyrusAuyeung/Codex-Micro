#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef StageDir
  #error StageDir is required
#endif
#ifndef OutputPath
  #error OutputPath is required
#endif
#ifndef BootstrapPath
  #error BootstrapPath is required
#endif

[Setup]
AppId={{80A07802-0732-482B-ADF1-66CF664AB34C}
AppName=Micro Windows
AppVersion={#AppVersion}
AppPublisher=CyrusAuyeung
AppPublisherURL=https://github.com/CyrusAuyeung/Codex-Micro
AppSupportURL=https://github.com/CyrusAuyeung/Codex-Micro/issues
AppUpdatesURL=https://github.com/CyrusAuyeung/Codex-Micro/releases/latest
DefaultDirName={localappdata}\Programs\Micro Windows
DefaultGroupName=Micro Windows
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputPath}
OutputBaseFilename=Micro-Windows-{#AppVersion}-Setup-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\assets\micro.ico
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\Micro Windows.exe
CloseApplications=no
RestartApplications=no
SetupLogging=yes
LicenseFile={#StageDir}\LICENSE

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BootstrapPath}"; Flags: dontcopy

[Icons]
Name: "{group}\Micro Windows"; Filename: "{app}\Micro Windows.exe"; IconFilename: "{app}\Micro Windows.exe"; AppUserModelID: "CyrusAuyeung.MicroWindows"
Name: "{autodesktop}\Micro Windows"; Filename: "{app}\Micro Windows.exe"; IconFilename: "{app}\Micro Windows.exe"; AppUserModelID: "CyrusAuyeung.MicroWindows"; Tasks: desktopicon

[Run]
Filename: "{app}\Micro Windows.exe"; Description: "启动 Micro Windows"; Flags: nowait postinstall skipifsilent

[Code]
const
  WebViewKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebView: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKCU, WebViewKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM32, WebViewKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function CloseMicro(Silent: Boolean): Boolean;
var Code: Integer; Args, ProgramPath: String;
begin
  Result := True;
  ProgramPath := ExpandConstant('{app}\Micro Windows.exe');
  if not FileExists(ProgramPath) then exit;
  if Silent then Args := '--shutdown-if-idle' else Args := '--shutdown-for-update';
  Result := Exec(ProgramPath, Args, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if not CloseMicro(WizardSilent) then begin
    Result := '请先完成键盘通信并保存修改，再从托盘退出 Micro Windows，然后重试安装。';
    exit;
  end;
  if not HasWebView then begin
    WizardForm.StatusLabel.Caption := '正在安装 WebView2，请保持联网…';
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then begin
      Result := '无法启动 WebView2 安装程序，请重新运行安装包。';
      exit;
    end;
    if not HasWebView then Result := 'WebView2 安装未完成。请检查网络后重新运行安装包。已有键位配置将保留。';
  end;
end;

function InitializeUninstall: Boolean;
begin
  Result := CloseMicro(UninstallSilent);
  if not Result and not UninstallSilent then MsgBox('请先保存修改并从托盘退出 Micro Windows，再卸载。', mbInformation, MB_OK);
end;
