const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

// Exercise the real renderer at inventory limits without starting services or connecting to hosts.
module.exports = async function inventoryNavigation(window, output) {
  const contents = window.webContents;
  const js = code => contents.executeJavaScript(code, true);
  const { openWorkspace } = require('./navigation-helpers.cjs')(window);
  const size = window.getSize(), minimum = window.getMinimumSize();
  const channels = [];
  let count = 2;
  let logRevision = 0;
  const fixtures = make => Array.from({length: count}, (_, i) => make(i));
  const state = instances => ({ revision: 1, platform: process.platform, directory: '/fixture', instances });
  const jar = i => ({ id: 'service-' + i, name: '服务 ' + i, jar: '/fixture/' + i + '.jar',
    logMode: i % 2 ? 'console' : 'file', profiles: [], health: { type: 'none' }, restart: {}, jvmArgs: [], appArgs: [] });
  const nginx = i => ({ id: 'ng-' + i, name: '网关 ' + i, main: '/fixture/' + i + '.conf', files: [], platform: 'any' });
  function handle(channel, respond) {
    channels.push(channel);
    contents.ipc.handle(channel, (_event, action, payload) => ({data: respond(action, payload)}));
  }
  async function wait(expr) {
    for (let i = 0; i < 120; i++) {
      if (await js('Boolean(' + expr + ')')) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Inventory navigation failed: ' + expr);
  }
  const painted = () => js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const element = selector => 'document.querySelector(' + JSON.stringify(selector) + ')';
  async function click(selector) {
    const el = element(selector);
    await wait(el + ' && !' + el + '.disabled');
    await js(el + '.focus();' + el + '.click()');
  }
  const visible = selector => `(() => {
    const el = ${element(selector)};
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  })()`;
  async function resize(width) {
    window.setContentSize(width, 844);
    await wait(width < 500 ? 'innerWidth < 450' : 'innerWidth > 1200');
    await painted();
  }
  async function serviceOutput(index) {
    const trigger = '[data-service-output="service-' + index + '"]';
    const display = '.jar-output-dialog[open] pre';
    await js(element(trigger) + ".scrollIntoView({block:'center'})");
    await wait(visible(trigger));
    const position = () => js(`[${element(trigger)}.getBoundingClientRect().top, document.querySelector('.jar-table-scroll').scrollTop]`);
    const before = await position();
    await click(trigger);
    await wait(element(display) + '?.textContent.includes("service-' + index + '") && document.activeElement === ' + element(display));
    await wait(visible(display));
    if (index % 2 === 0) {
      const pre = element(display);
      await wait(`${pre}.scrollHeight - ${pre}.clientHeight - ${pre}.scrollTop < 3`);
      await js(pre + '.scrollTop = 40');
      await painted();
      const nextRevision = logRevision + 1;
      await js("[...document.querySelectorAll('.jar-log-tools button')].find(b => b.textContent === '刷新日志').click()");
      await wait(pre + '.textContent.includes("revision ' + nextRevision + '")');
      assert.ok(Math.abs(await js(pre + '.scrollTop') - 40) <= 1, 'Refreshing preserves the history being read');
    }
    await js(element(display) + '.scrollTop = ' + element(display) + '.scrollHeight');
    const close = '.jar-output-dialog header > button';
    await wait(visible(close));
    if (index % 2) await wait(visible('.jar-console-input [type=submit]'));
    if (count === 100 && index % 2) {
      await js("Promise.all(document.querySelector('.jar-output-dialog').getAnimations().map(animation => animation.finished))");
      await painted();
      const width = await js('innerWidth');
      await fs.writeFile(path.join(output, 'services-100-console-' + width + '.png'), (await contents.capturePage()).toPNG());
    }
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait('!document.querySelector(".jar-output-dialog") && document.activeElement === ' + element(trigger));
    assert.deepEqual(await position(), before, 'Closing output restores the service row');
  }
  try {
    handle('devkit:jar', (action, payload) => {
      if (action === 'get') return state(fixtures(jar));
      if (action === 'statuses') return [];
      if (action === 'log-tail') return { text: (payload.id + ' log\n').repeat(400) + 'revision ' + (++logRevision), path: '/fixture/log' };
      if (action === 'console-read') return { available: true, inputOpen: true, lease: null, cursor: 1, end: 1,
        ...(!payload.cursor && {reset: true, text: (payload.id + ' console\n').repeat(400)}) };
    });
    handle('devkit:nginx', (action, payload) => {
      if (action === 'get') return state(fixtures(nginx));
      if (action === 'statuses') return [];
      if (action === 'documents') return { files: [{path: '/fixture/' + payload.id.slice(3) + '.conf', content: 'events {}', hash: 'fixture'}], warnings: [] };
    });
    handle('devkit:logs', (action, payload) => {
      if (action === 'sources') return { sources: Array.from({ length: count === 2 ? 2 : 300 }, (_, i) => ({
        id: 'log-' + i, name: '日志源 ' + i, kind: 'jar', mode: 'file', instanceId: 'service-' + i, path: '/fixture/' + i + '.log',
      })), warnings: [] };
      if (action === 'read') return { results: payload.sources.map(source => ({ id: source.id, text: 'INFO ' + source.id })) };
    });
    handle('devkit:lan-hosts', action => {
      if (action === 'list') return Array.from({length: Math.min(50, count)}, (_, i) => ({
        id: 'host-' + i, name: '主机 ' + i, mode: 'ssh', address: 'localhost', port: 22, user: 'test', platform: 'linux',
        fingerprint: 'fixture', auth: 'key', modules: {}, group: '', tags: [],
      }));
      if (action === 'terminal-open') return { id: 'fixture-session' };
      if (action === 'terminal-read') return { data: '', closed: false };
    });
    window.show(); window.focus(); contents.focus();
    window.setMinimumSize(360, 600);
    for (count of [2, 100]) {
      await resize(1340);
      await openWorkspace('服务管理');
      await wait('document.querySelector(".jar-summary strong")?.textContent === "' + count + '"');
      for (const width of [1340, 390]) {
        await resize(width);
        if (count === 100 && width === 1340) {
          const next = '[aria-label=服务列表分页] [aria-label=下一页]';
          for (let page = 1; page < 5; page++) { await click(next); await painted(); }
        }
        assert.equal(await js('document.querySelectorAll(".jar-instance").length'), Math.min(20, count));
        await serviceOutput(count - 2);
        await serviceOutput(count - 1);
      }
      if (count === 100) {
        await js("location.hash = '#jar/service-21'");
        await wait(element('[aria-label=服务列表分页]') + '?.textContent.includes("2 / 5") && ' + visible('[data-service-output=service-21]'));
      }
      await resize(1340);
      await openWorkspace('日志中心');
      const sources = count === 2 ? 2 : 300;
      await wait('document.querySelectorAll(".log-source-item").length === ' + sources);
      const source = '[data-source-id="log-' + (sources - 1) + '"]';
      await click(source);
      for (const width of [1340, 390]) {
        await resize(width);
        await click('.log-show-output');
        await wait('document.activeElement.matches(".log-pane[data-focused=true] pre") && document.activeElement.textContent.includes("log-' + (sources - 1) + '")');
        await wait(visible('.log-pane[data-focused=true] pre'));
        await click('.log-stream-nav > button');
        await wait('document.activeElement === ' + element(source) + ' && ' + visible(source));
      }
      await js("location.hash = '#logs/instance%3Aservice-0'");
      await wait('document.activeElement.matches(".log-pane[data-focused=true] pre") && document.activeElement.textContent.includes("log-0")');
      await resize(1340);
      await openWorkspace('Nginx 配置');
      await wait('!!document.querySelector(".ng-instance-select") && !document.querySelector(".ng-busy")');
      await js("[...document.querySelectorAll('.ng-heading button')].find(b => b.textContent.trim() === '刷新').click()");
      const target = '[data-instance-id="ng-' + (count - 1) + '"] .ng-instance-select';
      for (const width of [1340, 390]) {
        await resize(width);
        await click(target);
        await wait('document.activeElement.matches(".ng-instance-heading h2") && ' + visible('.ng-instance-heading h2'));
        await js("[...document.querySelectorAll('.ng-detail button')].find(b => b.textContent === '返回实例列表').click()");
        await wait('document.activeElement === ' + element(target) + ' && ' + visible(target));
      }
      await js("location.hash = '#nginx/ng-0'");
      await wait('document.activeElement.matches(".ng-instance-heading h2") && document.activeElement.textContent.includes("网关 0")');
      await resize(1340);
      await openWorkspace('局域网主机');
      const host = '[data-host-id="host-' + (Math.min(50, count) - 1) + '"]', summary = host + ' summary';
      for (const width of [1340, 390]) {
        await resize(width);
        await click(summary);
        await wait(element(host + ' details') + '.open');
        await js(`[...${element(host)}.querySelectorAll('button')].find(b => b.textContent === '打开终端').click()`);
        await wait(visible('.lan-terminal-tabs [aria-selected=true]'));
        await js("document.querySelector('.lan-terminal-tabs .icon-button').click()");
        await wait('document.activeElement === ' + element(summary) + ' && ' + visible(summary));
      }
    }
    console.log('Desktop and narrow list/detail navigation passed with 2 entries and 100 services, 300 log sources, 100 Nginx instances and 50 hosts.');
  } finally {
    for (const channel of channels) contents.ipc.removeHandler(channel);
    window.setSize(...size); window.setMinimumSize(...minimum);
  }
};
