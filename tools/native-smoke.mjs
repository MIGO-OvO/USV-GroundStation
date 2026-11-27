import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Opens the actual bundled WebView2 application. Never connects to a device.
const reservation = createServer();
await new Promise(r => reservation.listen(Number(process.env.USV_NATIVE_CDP_PORT || 0), '127.0.0.1', r));
const port = reservation.address().port;
await new Promise(r => reservation.close(r));
const binary = resolve(process.argv[2] || 'target/release/usv-groundstation.exe');
await mkdir('.reference', { recursive: true });
const profile = await mkdtemp(resolve('.reference/native-smoke-'));
const launchOptions = { windowsHide: true, env: { ...process.env,
  USV_GROUNDSTATION_DATA_DIR: profile,
  WEBVIEW2_USER_DATA_FOLDER: resolve(profile, 'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` }, stdio: 'pipe' };
let app = spawn(binary, [], launchOptions);
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
const sockets = new Set();
let connections = 0;
const peer = createServer(socket => {
  connections++;
  sockets.add(socket);
  socket.on('error', () => {});
  socket.on('close', () => sockets.delete(socket));
  socket.on('data', () => {});
});
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
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.getByRole('heading', { name: '航行驾驶舱' }).waitFor();
  const maximize = page.getByRole('button', { name: '最大化窗口' });
  const restore = page.getByRole('button', { name: '还原窗口' });
  const windowState = (property) => page.evaluate(property => window.__TAURI_INTERNALS__
    .invoke(`plugin:window|${property}`, { label: 'main' }), property);
  assert.equal(await windowState('is_decorated'), false);
  await maximize.click();
  await restore.waitFor();
  assert.equal(await windowState('is_maximized'), true);
  await restore.click();
  await maximize.waitFor();
  assert.equal(await windowState('is_maximized'), false);
  const snapshot = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('station_snapshot'));
  assert.equal(snapshot.link, 'disconnected');
  assert.equal(snapshot.telemetry.system_id, null);
  assert.equal(snapshot.identity_error, null);
  assert.equal(snapshot.log_error, null);
  const offlinePolicyError = await page.evaluate(async () => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    await invoke('map_set_offline', { offline: true });
    try {
      await invoke('map_location', { offline: false }).catch(() => null);
      return await invoke('map_tile', {
        source: 'google', baseUrl: '', style: 'gsatellite', z: 20, x: 0, y: 0, offline: false,
      }).then(() => null, error => String(error));
    } finally {
      await invoke('map_set_offline', { offline: false });
    }
  });
  assert.match(offlinePolicyError ?? '', /该区域尚无本机离线瓦片/,
    'Location lookup must not override the global offline setting');
  let mapEvidence = 'not requested';
  if (process.env.USV_NATIVE_ONLINE_MAP === '1') {
    const tile = { source: 'google', baseUrl: '', style: 'gsatellite', z: 0, x: 0, y: 0, offline: false };
    const [online, offline] = await page.evaluate(async args => {
      const online = await window.__TAURI_INTERNALS__.invoke('map_tile', args);
      const offline = await window.__TAURI_INTERNALS__.invoke('map_tile', { ...args, offline: true });
      return [online, offline];
    }, tile);
    assert(online.length > 100);
    assert.deepEqual(online, offline);
    mapEvidence = `${online.length} real Google bytes; cached bytes identical`;
  }
  await mkdir('.impeccable/review', { recursive: true });
  await page.screenshot({ path: '.impeccable/review/windows-native.png', fullPage: true });
  await page.getByRole('button', { name: '采样', exact: true }).click();
  await page.getByRole('region', { name: '采样进度' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '采样与实时数据' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '点采样', exact: true }).isDisabled(), true);
  for (const width of [960, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    const layout = await page.locator('.sampling').evaluate(workspace => {
      const header = workspace.querySelector('.sampling-heading').getBoundingClientRect();
      const plot = workspace.querySelector('.signal-plot').getBoundingClientRect();
      return { viewport: innerWidth, headerHeight: header.height, plotHeight: plot.height,
        plotBottom: plot.bottom, scrollBottom: workspace.querySelector('.sampling-scroll').getBoundingClientRect().bottom,
        overflow: workspace.scrollWidth - workspace.clientWidth };
    });
    assert.equal(layout.viewport, width);
    assert(layout.overflow <= 1, `Sampling layout overflows at ${width}px: ${JSON.stringify(layout)}`);
    if (width === 1280) {
      assert(layout.headerHeight < 100 && layout.plotHeight > 350 && layout.plotBottom <= layout.scrollBottom,
        `Sampling progress must leave space for the whole signal plot: ${JSON.stringify(layout)}`);
    }
  }
  await page.screenshot({ path: '.impeccable/review/windows-native-sampling.png', fullPage: true });
  await page.getByText('四轴反馈、PID 与设备状态', { exact: true }).click();
  assert.equal(await page.locator('.pump-axis svg').count(), 4);
  assert.equal(await page.locator('.pump-details pre').count(), 0);
  await page.getByRole('button', { name: '连接与设置' }).click();
  assert.equal(await page.getByRole('button', { name: '连接设备' }).isEnabled(), true);
  const serial = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('serial_ports'));
  assert(Array.isArray(serial) && serial.every(p => p.port && p.kind && p.label));
  await page.getByRole('button', { name: '固件刷写', exact: true }).click();
  const firmware = page.getByRole('dialog', { name: '飞控固件刷写' });
  await firmware.getByRole('button', { name: '取消', exact: true }).click();
  await firmware.waitFor({ state: 'hidden' });
  await page.getByRole('checkbox', { name: '启用底图' }).uncheck();
  await page.getByRole('button', { name: '诊断', exact: true }).click();
  assert.equal(await page.getByRole('heading', { name: '通信诊断' }).isVisible(), true);
  await new Promise(r => peer.listen(0, '127.0.0.1', r));
  const target = { config: { kind: 'tcp', host: '127.0.0.1', port: peer.address().port }, target_system: 7 };
  await page.getByRole('button', { name: '连接与设置' }).click();
  await page.getByRole('button', { name: 'TCP', exact: true }).click();
  await page.getByRole('textbox', { name: 'TCP 主机' }).fill(target.config.host);
  await page.getByRole('spinbutton', { name: '端口', exact: true }).fill(String(target.config.port));
  await page.getByRole('spinbutton', { name: '目标 sysid' }).fill('7');
  await page.getByRole('button', { name: '连接设备' }).click();
  const firstDeadline = Date.now() + 10000;
  while (connections < 1 && Date.now() < firstDeadline) await new Promise(r => setTimeout(r, 100));
  assert.equal(connections, 1);
  const readSnapshot = () => page.evaluate(() => window.__TAURI_INTERNALS__.invoke('station_snapshot'));
  const snapshotDeadline = Date.now() + 5000;
  let saved = await readSnapshot();
  while (!saved.saved_connection && !saved.connection_error && Date.now() < snapshotDeadline) {
    await new Promise(r => setTimeout(r, 100));
    saved = await readSnapshot();
  }
  assert.equal(saved.connection_error, null);
  assert.deepEqual(saved.saved_connection, target);
  const maintenanceError = await page.evaluate(() => window.__TAURI_INTERNALS__
    .invoke('firmware_probe', { target: null }).then(() => null, error => String(error)));
  assert.match(maintenanceError ?? '', /请先断开飞控连接/);
  await page.getByRole('button', { name: '断开', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '连接与设置' }).click();
  assert.equal(await page.getByRole('spinbutton', { name: '端口', exact: true }).inputValue(), String(target.config.port));
  await new Promise(r => setTimeout(r, 2300));
  assert.equal(connections, 1, 'frontend reload must preserve manual disconnect');
  await browser.close();
  browser = undefined;
  if (!processExit) {
    const exited = once(app, 'exit');
    app.kill();
    await exited;
  }
  app = spawn(binary, [], launchOptions);
  app.on('error', error => { processError = error; });
  const restartDeadline = Date.now() + 15000;
  while (connections < 2 && Date.now() < restartDeadline && !processError) await new Promise(r => setTimeout(r, 100));
  assert.ifError(processError);
  assert.equal(connections, 2, 'new native process must restore the saved TCP connection');
  await new Promise(r => setTimeout(r, 600));
  assert.equal(connections, 2, 'startup must open the connection once');
  assert.deepEqual(pageErrors, [], 'map startup and telemetry must not crash React');
  console.log(JSON.stringify({ result: 'passed', surface: 'Windows Tauri/WebView2', titlebar: 'undecorated window, maximize and restore checked', controlCore: 'live IPC snapshot', connectedDevice: false, profile, enumeratedPorts: serial.length, firmwareMaintenance: 'blocked with a configured MAVLink connection', offlinePolicy: 'preserved across location lookup', mapEvidence, startupAutoConnect: 'one loopback TCP connection after native process restart', manualDisconnect: 'preserved across frontend reload', screenshot: '.impeccable/review/windows-native.png' }));
} finally {
  if (browser) await browser.close();
  if (app.pid) app.kill();
  for (const socket of sockets) socket.destroy();
  peer.close();
}
