"""Build the Windows x64 executables using the installed .NET Framework compiler."""
import os, shutil, subprocess
from pathlib import Path

root=Path(__file__).resolve().parent
csc=Path(os.environ.get('WINDIR','C:/Windows'))/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if not csc.exists(): raise SystemExit('Missing .NET Framework C# compiler: '+str(csc))
base=[str(csc),'/nologo','/optimize+','/platform:x64','/r:System.Web.Extensions.dll','/win32manifest:'+str(root/'native/app.manifest')]
subprocess.run(base+['/target:exe','/out:'+str(root/'MicroHID.Windows.exe')]+[str(root/'native'/n) for n in ('HidDevice.cs','KeyboardOutput.cs','MicroHID.cs')],check=True)
subprocess.run(base+['/target:winexe','/r:System.Drawing.dll','/r:System.Windows.Forms.dll','/out:'+str(root/'Micro Windows.exe'),str(root/'native/Launcher.cs')],check=True)
subprocess.run(base+['/target:exe','/r:System.Windows.Forms.dll','/out:'+str(root/'MicroNetwork.Windows.exe'),str(root/'native/NetworkInfo.cs'),str(root/'native/NetworkRepair.cs')],check=True)
source=os.environ.get('MICRO_NODE_SOURCE')
if source: shutil.copy2(source,root/'runtime/node.exe')
if not (root/'runtime/node.exe').exists(): raise SystemExit('Set MICRO_NODE_SOURCE to an official Windows x64 Node.js 22+ executable, then rebuild.')
subprocess.run([str(root/'MicroHID.Windows.exe'),'--self-test'],check=True)
subprocess.run([str(root/'MicroNetwork.Windows.exe'),'--self-test'],check=True)
subprocess.run([str(root/'runtime/node.exe'),'--check',str(root/'server.mjs')],check=True)
print('Built Micro Windows.exe and MicroHID.Windows.exe (Windows x64).')
