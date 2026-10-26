const { app, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const staging = process.env.DEVKIT_TEST_APP;
const output = process.env.DEVKIT_TEST_OUTPUT;
if (!staging || !output) throw new Error('Run with npm run test:electron');
require('node:fs').mkdirSync(output, { recursive: true });
const installation = require('node:fs').mkdtempSync(path.join(output, 'installation-'));
const profile = path.join(installation, 'profile');
// Keep installation-local configs isolated from both the real installation and source tree.
process.env.DEVKIT_DEV_ROOT = installation;
require('node:fs').mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
let tested = false;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(output, 'saved.txt') });
const timeout = setTimeout(() => { console.error('Electron smoke check timed out'); app.exit(1); }, 300_000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error(`Renderer: ${event.message}`); });
  window.webContents.once('did-finish-load', async () => {
    if (tested) return;
    tested = true;
    try {
      await fs.mkdir(output, { recursive: true });
      const settings = window.webContents.getLastWebPreferences();
      assert.equal(settings.nodeIntegration, false);
      assert.equal(settings.contextIsolation, true);
      assert.equal(settings.sandbox, true);
      const globals = await window.webContents.executeJavaScript('({secure: isSecureContext, bridge: typeof window.devkitDesktop?.saveText, require: typeof window.require})');
      assert.deepEqual(globals, { secure: true, bridge: 'function', require: 'undefined' });
      const waitFor = async expression => {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (await window.webContents.executeJavaScript(expression)) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error(`UI condition not met: ${expression}`);
      };
      await waitFor('[...document.querySelectorAll("button")].some(button => button.getAttribute("aria-label") === "新建JSON 格式化任务")');
      if (process.env.DEVKIT_TEST_API_ONLY === '1') {
        await require('./api-smoke.cjs')(window, output);
        clearTimeout(timeout); app.exit(0); return;
      }
      if (process.env.DEVKIT_TEST_PROJECTS_ONLY === '1') {
        await require('./projects-smoke.cjs')(window, output, staging);
        clearTimeout(timeout); app.exit(0); return;
      }
      if (process.env.DEVKIT_TEST_HTTP_CLOSE_ONLY === '1') {
        await require('./close-behavior-smoke.cjs')(window, output);
        await require('./http-smoke.cjs')(window, output);
        await require('./close-smoke.cjs')(window, output);
        clearTimeout(timeout); return;
      }
      if (process.env.DEVKIT_TEST_FEATURES_ONLY === '1') {
        await require('./features-smoke.cjs')(window, output);
        clearTimeout(timeout); app.exit(0); return;
      }
      if (process.env.DEVKIT_TEST_NGINX_ONLY === '1') {
        await require('./nginx-smoke.cjs')(window, output);
        await require('./close-smoke.cjs')(window, output);
        clearTimeout(timeout); return;
      }
      if (process.env.DEVKIT_TEST_GEOGRAPHY_ONLY === '1') {
        window.setMinimumSize(360, 600); window.setSize(1440, 1000);
        await window.webContents.executeJavaScript('document.querySelector(\'button[aria-label="新建经纬度工具任务"]\').click()');
        await waitFor('!!document.querySelector(".geo-workbench")');
        await window.webContents.executeJavaScript('[...document.querySelectorAll(".geo-workbench .editor-footer button")].find(b=>b.textContent.includes("示例")).click()');
        await window.webContents.executeJavaScript('document.querySelector(".geo-workbench .run-button").click()');
        await waitFor('!!document.querySelector(".geo-workbench .status-success")');
        await require('./geography-smoke.cjs')(window, output);
        clearTimeout(timeout); app.exit(0); return;
      }
      await require('./design-smoke.cjs')(window, output);
      if (process.env.DEVKIT_TEST_DESIGN_ONLY === '1') { clearTimeout(timeout); app.exit(0); return; }
      await window.webContents.executeJavaScript(`{
        const input = document.querySelector('textarea[aria-label="待识别内容"]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '{"name":"推荐测试","id":9007199254740993}');
        input.dispatchEvent(new Event('input', {bubbles:true}));
      }`);
      await waitFor('!document.querySelector(".smart-open .run-button").disabled');
      await window.webContents.executeJavaScript('document.querySelector(".smart-open .run-button").click()');
      await waitFor('document.querySelectorAll(".smart-suggestion").length >= 3');
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');
      await fs.writeFile(path.join(output, 'preview-recommendations.png'), (await window.webContents.capturePage()).toPNG());
      const originalSize = window.getSize();
      const originalMinimum = window.getMinimumSize();
      window.setMinimumSize(360, 600);
      window.setSize(390, 844);
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');
      assert.ok(await window.webContents.executeJavaScript('window.innerWidth < 600'), 'Responsive screenshot must use a genuinely narrow viewport');
      assert.equal(await window.webContents.executeJavaScript('document.documentElement.scrollWidth <= window.innerWidth'), true);
      await fs.writeFile(path.join(output, 'preview-recommendations-narrow.png'), (await window.webContents.capturePage()).toPNG());
      window.setSize(...originalSize);
      window.setMinimumSize(...originalMinimum);
      await window.webContents.executeJavaScript('[...document.querySelectorAll(".smart-suggestion")].find(button => button.textContent.includes("YAML")).click()');
      await waitFor('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "JSON ↔ YAML"');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".task-pane:not([hidden]) .field-mode select").value'), 'json-yaml');
      await window.webContents.executeJavaScript('document.querySelector(".task-pane:not([hidden]) .run-button").click()');
      await waitFor('document.querySelector(".task-pane:not([hidden]) .status-success") !== null');
      await waitFor('document.querySelector(".task-pane:not([hidden]) .output-card .cm-content")?.textContent.includes("9007199254740993")');
      assert.equal(await window.webContents.executeJavaScript('JSON.stringify(localStorage).includes("推荐测试")'), false);
      await window.webContents.executeJavaScript('document.querySelector(".home-tab").click()');
      await window.webContents.executeJavaScript('[...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === "新建JSON 格式化任务").click()');
      await waitFor('!!document.querySelector(".task-pane:not([hidden]) .editor-footer button")');
      await window.webContents.executeJavaScript('[...document.querySelectorAll(".task-pane:not([hidden]) .editor-footer button")].find(button => button.textContent.includes("示例")).click()');
      await window.webContents.executeJavaScript('document.querySelector(".task-pane:not([hidden]) .run-button").click()');
      await waitFor('document.querySelector(".task-pane:not([hidden]) .status-success") !== null');
      const tree = await window.webContents.executeJavaScript('document.querySelector(".task-pane:not([hidden]) .result-preview").textContent');
      assert.match(tree, /DevKit/);
      const workerFile = (await fs.readdir(path.join(staging, 'dist', 'assets'))).find(name => /^tool\.worker-.*\.js$/.test(name));
      const runWorker = async (id, input, options) => window.webContents.executeJavaScript(`new Promise((resolve, reject) => { const worker = new Worker(${JSON.stringify(`devkit://app/assets/${workerFile}`)}, {type: 'module'}); const timeout = setTimeout(() => {worker.terminate(); reject(new Error('Worker timeout'))}, 5000); worker.onmessage = event => {clearTimeout(timeout); worker.terminate(); resolve(event.data)}; worker.onerror = event => {clearTimeout(timeout); worker.terminate(); reject(new Error(event.message))}; worker.postMessage(${JSON.stringify({ id, input, options })}); })`);
      const yaml = await runWorker('yaml', 'id: 9007199254740993\nname: 测试', { mode: 'yaml-json' });
      assert.equal(yaml.error, undefined); assert.match(yaml.output, /9007199254740993/);
      const sql = await runWorker('sql', 'select * from users', { dialect: 'sql', keywordCase: 'upper', indent: '2' });
      assert.equal(sql.error, undefined); assert.match(sql.output, /SELECT/);
      const hash = await runWorker('hash', 'hello', { algorithm: 'SHA-256' });
      assert.equal(hash.error, undefined); assert.equal(hash.output.length, 64);
      const developerCases = [
        ['code-format', 'const x={value:1}', { language: 'babel' }, /value: 1/],
        ['code-format', 'type User={id:number}', { language: 'typescript' }, /id: number/],
        ['code-format', '.a{color:red}', { language: 'css' }, /color: red/],
        ['code-format', '<div><p>Hello</p></div>', { language: 'html' }, /Hello/],
        ['json-path', '{"items":[9007199254740993]}', { path: '$.items[0]' }, /9007199254740993/],
        ['json-schema', '{"name":"Alice"}', {}, /2020-12/],
        ['query-string', 'tag=java&tag=react', {}, /react/],
        ['http-code', '{"url":"https://example.com"}', { style: 'fetch' }, /await fetch/],
        ['cron', '*/15 * * * *', { start: '2026-10-24T00:00:00Z', count: '1' }, /00:15:00/],
        ['env', 'APP_NAME=DevKit', {}, /DevKit/],
        ['properties', 'name=\\u4f60\\u597d', {}, /你好/],
        ['hmac', 'The quick brown fox jumps over the lazy dog', { key: 'key', algorithm: 'SHA-256' }, /^f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8$/],
        ['unicode', '\\u4f60\\u597d', { mode: 'decode' }, /你好/],
        ['css-unit', '16px', { from: 'px', to: 'rem', base: '16', viewport: '1440' }, /^1rem$/],
        ['http-status', '404', {}, /Not Found/],
        ['json-code', '{"id":1}', { language: 'ts', tsStyle: 'interface', rootName: 'User' }, /interface User/],
        ['json-code', '{"id":1}', { language: 'java', javaStyle: 'record', rootName: 'User' }, /record User/],
        ['type-json', 'interface User {id:number;name:string;tags:string[]}', { language: 'ts' }, /"id": 0/],
        ['type-json', 'class User {Long id; List<Profile> profiles; static class Profile {String city;}}', { language: 'java' }, /"city": ""/],
        ['type-json', 'record User(Address address) {record Address(String city){}}', { language: 'java' }, /"city": ""/],
        ['xml', '<root><!--local--><name>你好</name></root>', { mode: 'format', indent: '2' }, /\n  <name>你好<\/name>/],
        ['gzip', 'Hello', { mode: 'compress' }, /^H4sI/],
        ['gzip', 'H4sIAAAAAAACA/NIzcnJBwCCidH3BQAAAA==', { mode: 'decompress' }, /^Hello$/],
        ['ipv4', '192.168.10.42/24', {}, /192.168.10.254/],
        ['chmod', '4755', {}, /rwsr-xr-x/],
        ['ulid', '3', { timestamp: '0', mode: 'generate' }, /^0000000000/],
        ['ulid', '00000000000000000000000000', { mode: 'parse' }, /1970-01-01/],
        ['text-stats', '👨‍👩‍👧‍👦', {}, /"graphemeClusters": 1/],
      ];
      for (const [id, input, options, expected] of developerCases) {
        console.log(`Checking worker: ${id} ${options.language || ''}`);
        const result = await runWorker(id, input, options);
        assert.equal(result.error, undefined, `${id}: ${result.error}`);
        assert.match(result.output, expected);
      }
      // Exercise the visible tool workspace, not only the worker transform API.
      const { openTool } = require('./navigation-helpers.cjs')(window);
      await openTool('前端代码格式化');
      await waitFor('document.querySelector(".task-pane:not([hidden]) h1")?.textContent === "前端代码格式化"');
      await window.webContents.executeJavaScript('[...document.querySelectorAll(".task-pane:not([hidden]) .editor-footer button")].find(button => button.textContent.includes("示例")).click()');
      await window.webContents.executeJavaScript('document.querySelector(".task-pane:not([hidden]) .run-button").click()');
      await waitFor('document.querySelector(".task-pane:not([hidden]) .status-success") !== null');
      await waitFor('document.querySelector(".task-pane:not([hidden]) .output-card .cm-content")?.textContent.includes("const users")');
      await fs.writeFile(path.join(output, 'preview-developer-tools.png'), (await window.webContents.capturePage()).toPNG());
      const option = async (key, value) => {
        await window.webContents.executeJavaScript(`{ const select = document.querySelector('.task-pane:not([hidden]) .field-${key} select'); select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', {bubbles:true})); }`);
        await waitFor(`document.querySelector('.task-pane:not([hidden]) .field-${key} select')?.value === ${JSON.stringify(value)}`);
      };
      const sampleAndRun = async () => {
        await window.webContents.executeJavaScript('[...document.querySelectorAll(".task-pane:not([hidden]) .editor-footer button")].find(button => button.textContent.includes("示例"))?.click()');
        await window.webContents.executeJavaScript('document.querySelector(".task-pane:not([hidden]) .run-button").click()');
        await waitFor('document.querySelector(".task-pane:not([hidden]) .status-success") !== null');
      };
      await openTool('JSON 转类型');
      await option('language', 'java');
      await waitFor('!!document.querySelector(".task-pane:not([hidden]) .field-javaStyle")');
      await option('javaStyle', 'record'); await sampleAndRun();
      await waitFor('document.querySelector(".task-pane:not([hidden]) .output-card .cm-content")?.textContent.includes("public record Root")');
      await option('language', 'ts');
      await waitFor('!!document.querySelector(".task-pane:not([hidden]) .field-tsStyle")');
      await option('tsStyle', 'type'); await sampleAndRun();
      await waitFor('document.querySelector(".task-pane:not([hidden]) .output-card .cm-content")?.textContent.includes("export type Root")');
      await option('language', 'java');
      assert.equal(await window.webContents.executeJavaScript('document.querySelector(".task-pane:not([hidden]) .field-javaStyle select").value'), 'record');
      await openTool('类型转 JSON');
      await sampleAndRun();
      await option('language', 'java'); await sampleAndRun();
      await waitFor('document.querySelector(".task-pane:not([hidden]) .result-preview")?.textContent.includes("city")');
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 400))');
      await fs.writeFile(path.join(output, 'preview-type-conversion.png'), (await window.webContents.capturePage()).toPNG());
      for (const name of ['XML 格式化', 'GZip 压缩与解压', 'IPv4 子网计算', 'chmod 权限换算', 'ULID 生成与解析', '文本统计']) {
        await openTool(name); await sampleAndRun();
        if (name === 'GZip 压缩与解压') { await option('mode', 'decompress'); await sampleAndRun(); }
        if (name === 'ULID 生成与解析') { await option('mode', 'parse'); await sampleAndRun(); }
      }
      await window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 200))');
      await fs.writeFile(path.join(output, 'preview-text-stats.png'), (await window.webContents.capturePage()).toPNG());
      await require('./workflows-smoke.cjs')(window, output);
      const saved = await window.webContents.executeJavaScript('window.devkitDesktop.saveText("本地离线保存", "saved.txt")');
      assert.match(saved, /已保存/); assert.equal(await fs.readFile(path.join(output, 'saved.txt'), 'utf8'), '本地离线保存');
      dialog.showSaveDialog = async () => ({ canceled: true });
      assert.equal(await window.webContents.executeJavaScript('window.devkitDesktop.saveText("cancel", "cancel.txt")'), '已取消保存');
      await fs.writeFile(path.join(output, 'preview-electron.png'), (await window.webContents.capturePage()).toPNG());
      await require('./projects-smoke.cjs')(window, output, staging);
      await require('./nginx-smoke.cjs')(window, output);
      await require('./features-smoke.cjs')(window, output);
      await require('./close-behavior-smoke.cjs')(window, output);
      console.log('Electron smoke passed: sandbox, secure origin, explicit recommendations with direction/data transfer, responsive home, all extended tool UIs/workers, local parsers, Web Crypto, native-save IPC and cancel.');
      await require('./close-smoke.cjs')(window, output);
      clearTimeout(timeout);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require(path.join(staging, 'main.cjs'));
