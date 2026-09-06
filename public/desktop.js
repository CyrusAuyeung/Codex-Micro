const $ = id => document.getElementById(id);
// Scale the existing 416 px illustration as one piece, preserving every internal proportion.
const keyboard = document.querySelector('.keyboard-case');
const surface = keyboard.closest('.drawing-surface'), frame = document.createElement('div');
frame.className = 'keyboard-frame'; keyboard.before(frame); frame.append(keyboard);
const resizeKeyboard = () => {
  const css = getComputedStyle(surface), legend = surface.querySelector('.mapping-legend,.drawing-legend');
  const width = surface.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const height = surface.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - (legend?.offsetHeight || 0) - 24;
  const size = Math.max(1, Math.min(416, width, height));
  frame.style.width = frame.style.height = size + 'px';
  keyboard.style.transform = `scale(${size / 416})`;
};
new ResizeObserver(resizeKeyboard).observe(surface);
resizeKeyboard();
const about = document.createElement('dialog');
about.id = 'about-dialog'; about.setAttribute('aria-labelledby', 'about-title');
about.innerHTML = `<h2 id="about-title">Micro Windows</h2><p class="about-version" id="app-version">正在读取版本…</p><p id="update-status" role="status">正在检查更新…</p><p><a href="https://github.com/CyrusAuyeung/Codex-Micro" target="_blank" rel="noopener">项目主页与使用说明 ↗</a></p><div class="dialog-actions"><button id="quit-button" class="text-button">退出程序</button><button id="check-update" class="button">检查更新</button><a id="download-update" class="button primary" target="_blank" rel="noopener" hidden>下载安装包</a><button class="button" data-close>关闭</button></div>`;
document.body.append(about);
document.addEventListener('click', event => {
  const opener = event.target.closest('[data-dialog]');
  if (opener) $(opener.dataset.dialog).showModal();
  if (event.target.closest('[data-close]')) event.target.closest('dialog').close();
});
$('about-button').onclick = () => { about.showModal(); checkUpdates(); };
fetch('/api/health').then(r => r.json()).then(info => { $('app-version').textContent = 'Windows · ' + info.version; }).catch(() => {});
$('quit-button').onclick = () => {
  if (window.chrome?.webview) window.chrome.webview.postMessage('quit');
  else window.microQuit?.();
};
async function checkUpdates(force = false) {
  $('check-update').disabled = true;
  try {
    const response = await fetch('/api/updates', {method: 'POST', headers: {'Content-Type':'application/json','X-Micro-Panel':'1'}, body: JSON.stringify({force})});
    if (!response.ok) throw new Error();
    const update = await response.json();
    $('app-version').textContent = 'Windows · ' + update.current;
    $('update-dot').hidden = !update.available;
    $('update-status').textContent = update.available ? `发现 ${update.version}。下载后运行安装程序即可更新，已有配置会保留。` : update.error || (update.simulation ? '模拟测试环境' : '当前已是最新版本。');
    $('download-update').hidden = !update.available;
    if (update.available) $('download-update').href = update.url;
  } catch { $('update-status').textContent = '暂时无法检查更新，请稍后重试。'; }
  finally { $('check-update').disabled = false; }
}
$('check-update').onclick = () => checkUpdates(true);
// A route change must not interrupt a device operation; ordinary drafts use beforeunload.
document.querySelectorAll('.mode-tabs a').forEach(link => link.addEventListener('click', event => {
  if (window.microDesktopState?.().busy) { event.preventDefault(); return; }
  if (new URL(link.href).pathname === location.pathname) event.preventDefault();
}));
checkUpdates();
