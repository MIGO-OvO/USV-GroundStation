import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Opens the actual bundled WebView2 application. Never connects to a device.
const reservation = createServer();
await new Promise(r => reservation.listen(Number(process.env.USV_NATIVE_CDP_PORT || 0), '127.0.0.1', r));
const port = reservation.address().port;
await new Promise(r => reservation.close(r));
const binary = resolve(process.argv[2] || 'target/release/usv-groundstation.exe');
const app = spawn(binary, [], { windowsHide: true, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'pipe' });
let processError;
let processExit;
let processOutput = '';
app.on('error', e => { processError = e; });
app.on('exit', (code, signal) => { processExit = { code, signal }; });
for (const stream of [app.stdout, app.stderr]) {
  stream.on('data', data => { processOutput = (processOutput + data.toString()).slice(-16384); });
}
let browser;
let connectionError;
try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !browser) {
    if (processError) throw processError;
    if (processExit) throw new Error(`Native app exited: ${JSON.stringify(processExit)}\n${processOutput}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); }
    catch (error) { connectionError = error; await new Promise(r => setTimeout(r, 300)); }
  }
  if (!browser) {
    console.error('[native-smoke] CDP connection:', connectionError?.message);
    const endpoint = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
      .then(async response => ({ status: response.status, body: await response.text() }))
      .catch(error => ({ error: error.message, cause: error.cause?.message }));
    console.error('[native-smoke] Direct endpoint:', JSON.stringify(endpoint));
    const processes = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -or $_.ProcessId -eq ${app.pid} } | Select-Object Name, ProcessId, ParentProcessId, CommandLine | ConvertTo-Json`],
      { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    console.error('[native-smoke] App and WebView processes:', processes.stdout, processes.stderr);
  }
  assert(browser, `WebView2 CDP endpoint did not open\n${processOutput}`);
  let page;
  while (Date.now() < deadline && !page) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => !p.url().startsWith('devtools:'));
    if (!page) await new Promise(r => setTimeout(r, 100));
  }
  assert(page, 'Tauri webview page missing');
  await page.getByRole('heading', { name: '航行驾驶舱' }).waitFor();
  const snapshot = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('station_snapshot'));
  assert.equal(snapshot.link, 'disconnected');
  assert.equal(snapshot.telemetry.system_id, null);
  assert.equal(snapshot.identity_error, null);
  assert.equal(snapshot.log_error, null);
  await mkdir('.impeccable/review', { recursive: true });
  await page.screenshot({ path: '.impeccable/review/windows-native.png', fullPage: true });
  await page.getByRole('button', { name: '连接与设置' }).click();
  assert.equal(await page.getByRole('button', { name: '连接设备' }).isEnabled(), true);
  await page.getByRole('button', { name: '诊断', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '通信诊断' }).isVisible(), true);
  console.log(JSON.stringify({ result: 'passed', surface: 'Windows Tauri/WebView2', controlCore: 'live IPC snapshot', connectedDevice: false, screenshot: '.impeccable/review/windows-native.png' }));
} finally {
  if (browser) await browser.close();
  if (app.pid) app.kill();
}
