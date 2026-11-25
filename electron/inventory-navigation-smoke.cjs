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
  const hostCount = () => Math.min(50, count);
  const group = (id, phase) => ({ id, name: id || '本机', platform: 'linux', revision: 1, phase, edit: true, control: true });
  function inventory(payload, makeInstance) {
    if (payload?.scope === 'inventory-progress') return [];
    if (payload?.scope === 'inventory-host') {
      const failed = payload.hostId === 'host-0';
      const remote = group(payload.hostId, failed ? 'failed' : 'ready');
      if (failed) remote.error = '测试连接失败';
      return { ...state([]), groups: [remote] };
    }
    const groups = Array.from({length: hostCount()}, (_, i) => group('host-' + i, 'connecting'));
    if (payload?.scope === 'inventory') {
      for (const remote of groups) Object.assign(remote, { phase: 'failed', error: '测试连接失败', edit: false, control: false });
    }
    return { ...state(fixtures(makeInstance)), groups: [group('', 'ready'), ...groups] };
  }
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
  async function checkHostProgress(workspace) {
    const details = workspace + ' .host-progress', list = details + ' ul';
    await wait(element(details + ' summary') + '?.textContent.includes("已连接 ' + (hostCount() - 1) + '")');
    assert.match(await js(element(details + ' summary') + '.textContent'), /失败 1/);
    assert.ok(await js('!' + element(details) + '.open && ' + element(details) + '.offsetHeight <= 40'));
    await click(details + ' summary');
    await wait(element(list) + '.offsetHeight > 0');
    const metrics = await js(`(() => { const list = ${element(list)}; return [list.children.length, list.clientHeight, list.scrollHeight]; })()`);
    assert.equal(metrics[0], hostCount());
    assert.ok(metrics[1] <= 180);
    if (hostCount() === 50) assert.ok(metrics[2] > metrics[1]);
    assert.equal(await js(element(list + ' button') + '.textContent'), '重试');
    await click(details + ' summary');
  }
  async function checkDisclosure(selector, listSelector, items) {
    const summary = selector + ' > summary', list = element(selector + ' > ' + listSelector);
    await wait(element(summary) + '?.textContent.includes("' + items + '")');
    assert.ok(await js('!' + element(selector) + '.open && ' + element(selector) + '.offsetHeight <= 40'));
    await click(summary);
    await wait(list + '.clientHeight > 0');
    assert.equal(await js(list + '.children.length'), items);
    assert.ok(await js(list + '.clientHeight <= 120'));
    const before = await js(element(summary) + '.getBoundingClientRect().top');
    await js(list + '.scrollTop = ' + list + '.scrollHeight');
    if (items === 50) assert.ok(await js(list + '.scrollTop > 0'));
    assert.equal(await js(element(summary) + '.getBoundingClientRect().top'), before, 'Summary stays in place when scrolling details');
    await click(summary);
  }
  async function hoverHost(summary) {
    const rect = await js(`(() => {
      const target = ${element(summary)};
      target.scrollIntoView({block:'nearest'});
      const {x,y,width,height} = target.getBoundingClientRect();
      return {x: Math.round(x + width / 2), y: Math.round(y + height / 2)};
    })()`);
    const layout = () => js(`(() => { const list = document.querySelector('.lan-host-list');
      return [list.clientHeight, list.scrollHeight, list.scrollTop, ${element(summary)}.offsetHeight, ${element(summary)}.closest('li').innerText]; })()`);
    const before = await layout();
    contents.sendInputEvent({type: 'mouseMove', ...rect});
    await wait(element(summary) + '.matches(":hover")');
    await painted();
    assert.deepEqual(await layout(), before, 'Hover keeps host content, height and scroll position stable');
    assert.equal(await js(element(summary) + '.parentElement.open'), false);
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
      if (action === 'get') return inventory(payload, jar);
      if (action === 'statuses') return [];
      if (action === 'log-tail') return { text: (payload.id + ' log\n').repeat(400) + 'revision ' + (++logRevision), path: '/fixture/log' };
      if (action === 'console-read') return { available: true, inputOpen: true, lease: null, cursor: 1, end: 1,
        ...(!payload.cursor && {reset: true, text: (payload.id + ' console\n').repeat(400)}) };
    });
    handle('devkit:nginx', (action, payload) => {
      if (action === 'get') return inventory(payload, nginx);
      if (action === 'statuses') return [];
      if (action === 'documents') return { files: [{path: '/fixture/' + payload.id.slice(3) + '.conf', content: 'events {}', hash: 'fixture'}], warnings: [] };
    });
    handle('devkit:logs', (action, payload) => {
      if (action === 'sources' && payload?.hostId) return { sources: [], warnings: ['读取失败'] };
      if (action === 'sources') return { sources: Array.from({ length: count === 2 ? 2 : 300 }, (_, i) => ({
        id: 'log-' + i, name: '日志源 ' + i, kind: 'jar', mode: 'file', instanceId: 'service-' + i, path: '/fixture/' + i + '.log',
      })), warnings: [], hosts: Array.from({length: hostCount()}, (_, i) => ({id: 'host-' + i, name: '主机 ' + i})) };
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
        await checkHostProgress('.jar-center');
        await click('.config-storage-trigger');
        await checkDisclosure('.config-source .notice-list', 'ul', hostCount());
        await wait(visible('.config-source select'));
        await click('dialog:has(.config-source) footer button');
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
        await checkDisclosure('.log-sources .notice-list', 'ul', hostCount());
        const pathDetails = '.log-source-item:has(' + source + ') .path-summary';
        await click(pathDetails + ' summary');
        await wait(element(pathDetails) + '.open && document.activeElement === ' + element(pathDetails + ' summary'));
        assert.equal(await js(element(pathDetails + ' > code') + '.innerText'), '/fixture/' + (sources - 1) + '.log');
        assert.equal(await js(element(pathDetails + ' [popover]') + ' === null'), true);
        await click(pathDetails + ' summary');
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
        await checkHostProgress('.ng-center');
        await click(target);
        await wait('document.activeElement.matches(".ng-instance-heading h2") && ' + visible('.ng-instance-heading h2'));
        await js("[...document.querySelectorAll('.ng-detail button')].find(b => b.textContent === '返回实例列表').click()");
        await wait('document.activeElement === ' + element(target) + ' && ' + visible(target));
      }
      await js("location.hash = '#nginx/ng-0'");
      await wait('document.activeElement.matches(".ng-instance-heading h2") && document.activeElement.textContent.includes("网关 0")');
      await resize(1340);
      await openWorkspace('局域网主机');
      await wait('document.querySelectorAll(".lan-host-list [data-host-id]").length === ' + hostCount());
      for (const width of [1340, 390]) {
        await resize(width);
        const list = element('.lan-host-list');
        assert.ok(await js(list + '.clientHeight') <= (width < 500 ? 240 : 360));
        assert.equal(await js(list + '.scrollHeight > ' + list + '.clientHeight'), count > 2);
        for (const id of [0, hostCount() - 1]) {
          const host = '[data-host-id="host-' + id + '"]', summary = host + ' summary';
          await hoverHost(summary);
          await click(summary);
          await wait(element(host + ' details') + '.open');
          await js(`[...${element(host)}.querySelectorAll('button')].find(b => b.textContent === '打开终端').click()`);
          await wait(visible('.lan-terminal-tabs [aria-selected=true]'));
          await js("document.querySelector('.lan-terminal-tabs .icon-button').click()");
          await wait('document.activeElement === ' + element(summary) + ' && ' + visible(summary));
        }
      }
      await resize(1340);
      await openWorkspace(count === 2 ? '团队知识库' : '开发文档管理');
      const create = '[...document.querySelectorAll(".kb-header button")].find(button => button.checkVisibility() && button.textContent.trim() === "新建文档")';
      await wait(create + ' && !' + create + '.disabled');
      await js(create + '.click()');
      const picker = '[...document.querySelectorAll(".kb-writing-tools button")].find(button => button.checkVisibility() && button.textContent.trim() === "插入资源")';
      await wait(picker);
      await js(picker + '.click()');
      await js("[...document.querySelectorAll('.kb-filters label')].find(label => label.textContent === '局域网主机').click()");
      const choices = "[...document.querySelectorAll('.kb-choices label')].filter(label => label.querySelector('small').textContent.startsWith('局域网主机'))";
      await wait(choices + '.length === ' + hostCount());
      await js(choices + ".forEach(label => label.querySelector('input').click())");
      for (const width of [1340, 390]) {
        await resize(width);
        await checkDisclosure('.kb-selected', 'div', hostCount());
        await wait(visible('.kb-resource-dialog footer .run-button'));
      }
      await click('.kb-selected summary');
      await click('.kb-selected button:last-child');
      await wait(element('.kb-resource-dialog footer .run-button') + '.textContent === "插入 ' + (hostCount() - 1) + ' 项"');
      await click('.kb-resource-dialog footer .secondary-button');
    }
    console.log('Desktop and narrow list/detail navigation passed with 2 entries and 100 services, 300 log sources, 100 Nginx instances and 50 hosts.');
  } finally {
    for (const channel of channels) contents.ipc.removeHandler(channel);
    window.setSize(...size); window.setMinimumSize(...minimum);
  }
};
