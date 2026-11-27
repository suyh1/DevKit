const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs/promises');
const { BrowserWindow, clipboard, dialog } = require('electron');

module.exports = async function collaborationSmoke(window, output) {
  window.webContents.setBackgroundThrottling(false);
  window.show();
  const desktop = (code) => window.webContents.executeJavaScript(code, true);
  const { openWorkspace } = require('./navigation-helpers.cjs')(window);
  const { emptySharingServices } = await import('../shared/sharing.mjs');
  const services = emptySharingServices();
  for (const id of ['mock', 'transfer', 'whiteboard', 'relay']) services[id] = { enabled: true, edit: true };
  services.relay.control = true;
  services.http = { enabled:true, edit:true, send:true };
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const lan = process.env.DEVKIT_TEST_COLLAB_LAN === '1';
  const settings = {
    port,
    host: lan ? '0.0.0.0' : '127.0.0.1',
    services,
    visitors: [],
    password: require('node:crypto').randomBytes(20).toString('hex'),
  };
  const start = await desktop('window.devkitProjects.request("start",' + JSON.stringify(settings) + ')');
  assert.equal(start.error, undefined);
  const browser = new BrowserWindow({
    show: false,
    width: 1120,
    height: 850,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      backgroundThrottling: false,
      partition: 'collab-test-' + Date.now(),
    },
  });
  const web = (code) => browser.webContents.executeJavaScript(code, true);
  const current = '.portal-page:not([hidden]) .collab-page ';
  const main = '.workspace:not([hidden]) .collab-page ';
  async function captureRelay(surface, name) {
    await surface.webContents.executeJavaScript(`Promise.allSettled(document.getAnimations()
      .filter(a => a.effect?.getComputedTiming().endTime < 1000).map(a => a.finished))`);
    await surface.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const snapshot = await surface.webContents.capturePage();
    await fs.writeFile(path.join(output, name + '.png'), snapshot.toPNG());
  }
  async function checkRelayForm(js) {
    const layout = await js(`(() => {
      const form = document.querySelector('dialog[open] .relay-form');
      const body = form.querySelector('.pc-modal-body');
      body.scrollTop = body.scrollHeight;
      const submit = form.querySelector('.run-button');
      const r = submit.getBoundingClientRect();
      const input = form.querySelector('input');
      return { fits: body.scrollWidth <= body.clientWidth + 1,
        readable: parseFloat(getComputedStyle(input).fontSize) >= 16,
        visible: r.top >= 0 && r.bottom <= innerHeight && submit.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)) };
    })()`);
    assert.deepEqual(layout, { fits:true, readable:true, visible:true });
  }
  async function wait(js, expr) {
    for (let i = 0; i < 180; i++) {
      if (await js(expr)) return;
      await new Promise((resolve) => setTimeout(resolve, 55));
    }
    throw new Error('Expected ' + expr + ' in ' + (await js('document.body.innerText')).slice(-1600));
  }
  async function fill(js, selector, value) {
    const node = 'document.querySelector(' + JSON.stringify(selector) + ')';
    await wait(js, '!!' + node);
    await js(
      `{const el=${node};Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`,
    );
  }
  async function click(js, scope, label) {
    const node = `[...document.querySelectorAll(${JSON.stringify(scope + 'button')})].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
    await wait(js, '!!' + node);
    await js(node + '.click()');
  }
  async function selectMode(js, scope, value) {
    const selector = scope + '[aria-label="发送方式"] button[value="' + value + '"]';
    await js('document.querySelector(' + JSON.stringify(selector) + ').click()');
  }
  try {
    // The fixture starts the listener via IPC. Opening settings refreshes the same provider used by invitations.
    await desktop('document.querySelector(".topbar .global-sharing-button").click()');
    await wait(
      desktop,
      'document.querySelector(".topbar .global-sharing-button")?.dataset.sharingState === "running" && document.querySelector(".sharing-panel dialog")?.getAttribute("aria-busy") !== "true"',
    );
    assert.equal(await desktop('!!document.querySelector(".sharing-panel .transfer-link-settings")'), false);
    await desktop('document.querySelector(".sharing-panel button[aria-label=关闭共享设置]").click()');
    await wait(desktop, '!document.querySelector(".sharing-panel")');
    await openWorkspace('局域网快传');
    assert.equal(await desktop('document.querySelector(' + JSON.stringify(main + '[aria-label="发送方式"] button[aria-pressed=true]') + ').value'), 'direct');
    await selectMode(desktop, main, 'stored');
    await fill(desktop, main + 'textarea', '跨设备取件测试');
    await fill(desktop, main + 'input[type=password]', 'case-pass');
    await click(desktop, main, '发送文字或链接');
    await wait(desktop, 'document.querySelector(".collab-inbox [role=status]")?.textContent.includes("已发送 1 项，剩余 0 项")');
    assert.equal(await desktop('[...document.querySelectorAll(".workspace:not([hidden]) [role=status]")].filter(el=>el.textContent.includes("已发送 1 项")).length'), 1);
    await click(desktop, main, '邀请设备');
    let address = 'http://127.0.0.1:' + port + '/#transfer';
    if (lan) {
      await wait(desktop, '!!document.querySelector(".collab-invite img")');
      address = await desktop('document.querySelector(".collab-invite p").textContent');
      assert.notEqual(new URL(address).hostname, '127.0.0.1');
    }
    await desktop('document.querySelector(".collab-invite").closest("dialog").querySelector("[aria-label=关闭邀请设备]").click()');
    await browser.loadURL(address);
    await fill(web, '.portal-login input[type=password]', settings.password);
    await click(web, '.portal-login ', '登录');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden])")');
    await openWorkspace('跨网互联');
    if (process.env.DEVKIT_TEST_COLLAB_ONLY === '1') {
      await click(desktop,main,'取消部署');
      await wait(desktop,'document.querySelector(".relay-deployment [role=status]")?.textContent.includes("已恢复")');
    }
    await web('location.hash="relay"');
    // Use the real desktop reader and exporter, without changing any OS networking.
    const hostIp = Object.values(require('node:os').networkInterfaces()).flat().find(ip => ip.family === 'IPv4' && !ip.internal && !ip.address.startsWith('169.254.'))?.address;
    if (hostIp) {
      await fill(desktop, main + '.gateway-address input',hostIp);
      await click(desktop, main, '读取 A 的网段');
      await wait(desktop, '!!document.querySelector(".gateway-workspace textarea")');
      const originalDialog = dialog.showSaveDialog;
      const file = path.join(output,'gateway-smoke.zip');
      dialog.showSaveDialog = async () => ({ canceled:false, filePath:file });
      try {
        await fill(desktop, main + '.gateway-workspace textarea','198.51.100.0/24\n203.0.113.0/24');
        await click(desktop,main,'直连网关');
        await click(desktop,main,'导出网关路由');
        await wait(desktop,'document.querySelector(".gateway-workspace section [role=status]")?.textContent.includes("配置已保存到")');
        const JSZip = require('jszip');
        assert.ok((await JSZip.loadAsync(await fs.readFile(file))).file('A/forward.sh'));
        await click(desktop,main,'三层隧道');
        await click(desktop,main,'导出 A、B、C 隧道配置');
        await wait(desktop,'document.querySelector(".gateway-workspace section [role=status]")?.textContent.includes("配置已保存到")');
        const archive = await JSZip.loadAsync(await fs.readFile(file));
        assert.ok(archive.file('B/devkit-b.conf') && archive.file('C/prepare.ps1'));
      } finally { dialog.showSaveDialog = originalDialog; await fs.rm(file,{force:true}); }
      await fill(desktop,main + 'input[aria-label="访问设备的 IPv4 地址"]','192.0.2.42');
      const desktopBounds = window.getBounds();
      const prefixes = Array.from({length:4096},(_,i) => '10.' + (i >> 8) + '.' + (i & 255) + '.0/24').join('\n');
      for (const width of [desktopBounds.width,390]) {
        window.setContentSize(width,740);
        for (const targets of ['198.51.100.0/24',prefixes]) {
          await fill(desktop, main + '.gateway-workspace textarea',targets);
          assert.ok(await desktop(`(() => {
            const area=document.querySelector('.gateway-workspace textarea'), button=document.querySelector('.gateway-workspace section > button.primary-button');
            button.focus(); return document.activeElement===button && (button.compareDocumentPosition(area)&Node.DOCUMENT_POSITION_FOLLOWING) &&
              area.offsetHeight<=innerHeight/3 && button.getBoundingClientRect().bottom<=innerHeight+1;
          })()`));
        }
      }
      window.setBounds(desktopBounds);
      const bounds = browser.getBounds();
      for (const width of [390,320]) {
        browser.setContentSize(width,740);
        await fill(web,current + '.gateway-address input',hostIp);
        await click(web,current,(await web('!!document.querySelector(".gateway-workspace textarea")')) ? '重新读取网段' : '读取 A 的网段');
        await wait(web,'!!document.querySelector(".gateway-workspace textarea")');
        assert.equal(await web('document.querySelector(".gateway-workspace textarea").readOnly'),true);
        assert.equal(await web('document.querySelector(".gateway-workspace").scrollWidth <= document.querySelector(".gateway-workspace").clientWidth + 1'),true);
      }
      browser.setBounds(bounds);
    }
    await click(web, current, '原 IP 双向互通');
    await click(web, current, '新建互通方案');
    await wait(web, '!!document.querySelector("dialog[open] .relay-device-inputs")');
    assert.equal(await web('document.querySelectorAll("dialog[open] .relay-ip").length'),3);
    for (const [label,value] of [['方案名称','测试网络'],['A 中间这台设备的 IP','192.0.2.1'],['B 要互通的第一台设备的 IP','192.0.2.2'],['C 要互通的第二台设备的 IP','192.0.2.6']])
      await fill(web, 'dialog input[aria-label="' + label + '"]',value);
    await click(web,'dialog ','保存草稿');
    await wait(web, 'document.body.innerText.includes("三个 IP 已保存为草稿")');
    await click(desktop, main, '原 IP 双向互通');
    await click(desktop, main, '继续填写');
    await wait(desktop, '!!document.querySelector("dialog[open] .relay-addresses input")');
    await checkRelayForm(desktop);
    await captureRelay(window, 'relay-plan-editor');
    assert.equal(await desktop(`!!document.querySelector('dialog input[aria-label="从 B 直接连接 A 时用的 IP"]')`),false);
    for (const [label,value] of [['方案名称','测试网络'],['A 中间这台设备的 IP','192.0.2.1'],['B 要互通的第一台设备的 IP','192.0.2.2'],['C 要互通的第二台设备的 IP','192.0.2.6']])
      assert.equal(await desktop('document.querySelector(\'dialog input[aria-label="' + label + '"]\').value'),value);
    await click(desktop, 'dialog ', '仅保存');
    await wait(desktop, `!!document.querySelector('dialog select[aria-label="确认安装位置"]')`);
    await desktop(`(() => { const s=document.querySelector('dialog select[aria-label="确认安装位置"]'); s.value='B'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await click(desktop, 'dialog ', '仅保存');
    for (const [label,value] of [['从 B 直接连接 A 时用的 IP','192.0.2.1'],['从 C 直接连接 A 时用的 IP','192.0.2.5']])
      await fill(desktop, 'dialog input[aria-label="' + label + '"]', value);
    await click(desktop, 'dialog ', '仅保存');
    await wait(desktop, 'document.body.innerText.includes("测试网络")');
    await wait(desktop, '!!document.querySelector(".relay-check details")');
    await desktop('document.querySelector(".relay-check details").open=true');
    await fill(desktop,'.relay-check input','8000');
    await click(desktop,main,'检测双向互通');
    await wait(desktop, 'document.querySelectorAll(".relay-direction-results > div").length===2');
    assert.equal(await desktop('document.querySelector(".relay-direction-results").textContent.includes("TCP 8000")'),true);
    await click(desktop, main, '一键配置');
    await wait(desktop, 'document.querySelector("dialog")?.innerText.includes("补全 A 的 SSH 管理档案") && !!document.querySelector("dialog input[type=password]")');
    await desktop(`document.querySelector('dialog button[aria-label="返回互通方案"]').click()`);
    await wait(desktop, 'Array.from(document.querySelectorAll("dialog button")).some(b => b.textContent==="配置 A、B、C" && b.disabled)');
    await desktop('document.querySelector(\'dialog button[aria-label="关闭路由配置"]\').click()');
    // Exercise the renderer's two missing-profile transitions with a deterministic desktop bridge.
    // The backend suite separately checks real SSH credentials, host keys and persistence.
    await click(web, current, '服务转发');
    const routingBounds = browser.getBounds();
    const portalTheme = await web('document.documentElement.dataset.theme');
    for (const localRole of ['B','C']) {
      browser.setContentSize(localRole === 'B' ? 390 : 320, 640);
      await web('document.documentElement.dataset.theme=' + JSON.stringify(localRole === 'B' ? 'light' : 'dark'));
      const peerRole = localRole === 'B' ? 'C' : 'B';
      await web(`(() => {
        const local = ${JSON.stringify(localRole)}, peer = ${JSON.stringify(peerRole)};
        const profiles = {}, hosts = [], fingerprint = 'SHA256:' + 'x'.repeat(43);
        window.routingTrace = [];
        window.devkitDesktop = { lanHosts: async (action,value) => {
          if (action === 'list') return {data:hosts};
          if (value.jumpHostId !== (value.address === '192.0.2.1' ? undefined : 'A')) throw Error('Unexpected SSH path');
          if (action === 'routing-fingerprint') {
            if ('password' in value) throw Error('Password sent before confirmation');
            return {data:{fingerprint}};
          }
          if (action !== 'routing-enroll' || value.fingerprint !== fingerprint || value.password !== 'fixture') throw Error('Unexpected enrollment');
          const role=value.address==='192.0.2.1'?'A':peer;
          const host={id:role,name:role,mode:'ssh',address:value.address,user:value.user,port:value.port,jumpHostId:value.jumpHostId,fingerprint};
          hosts.push(host); profiles[role]=host.id; window.routingTrace.push(role);
          return {data:host};
        }};
        window.devkitCollab = { request:async (module,action,value) => {
          if(action==='list') return {data:{version:'fixture',items:[]}};
          if(action==='discover') return {data:{role:local,profiles:{...profiles},ab:profiles.A?{ip:'192.0.2.1'}:{reason:'A 待补录'},ac:profiles.A?{ip:'192.0.2.5'}:{reason:'A 待补录'}}};
          if(action==='save') return {data:{id:'fixture-plan',revision:1}};
          if(action==='apply' && value.profiles.A==='A' && value.profiles[peer]===peer){ window.routingTrace.push('apply'); return {data:'完成'}; }
          throw Error('Unexpected action');
        }};
      })()`);
      await click(web, current, '原 IP 双向互通');
      await click(web, current, '新建互通方案');
      await wait(web, '!!document.querySelector("dialog[open] .relay-device-inputs")');
      await checkRelayForm(web);
      for (const [label,value] of [['A 中间这台设备的 IP','192.0.2.1'],['B 要互通的第一台设备的 IP','192.0.2.2'],['C 要互通的第二台设备的 IP','192.0.2.6']])
        await fill(web, 'dialog input[aria-label="' + label + '"]',value);
      await click(web,'dialog ','检测并配置');
      for (const role of ['A',peerRole]) {
        await wait(web, 'document.body.innerText.includes("补全 ' + role + ' 的 SSH 管理档案")');
        await wait(web, '!!document.querySelector("dialog[open] input[type=password]")');
        await checkRelayForm(web);
        await wait(web, 'document.activeElement===document.querySelector("dialog[open] input[autocomplete=off]")');
        browser.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});
        browser.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
        await wait(web, 'document.activeElement.type==="password"');
        await fill(web,'dialog[open] input[autocomplete=off]','operator');
        await fill(web,'dialog[open] input[type=password]','fixture');
        await click(web,'dialog ','核对 SSH 指纹');
        if (role===peerRole) {
          await wait(web, 'document.querySelector(".confirm-dialog[open]")?.innerText.includes("（192.0.2.1）连接")');
          assert.equal(await web(`(() => { const key=document.querySelector('.relay-key'); return key.textContent.length===50 && key.scrollWidth<=key.clientWidth+1; })()`), true);
          await captureRelay(browser, 'relay-fingerprint-' + localRole);
        }
        if (role==='A') {
          await click(web,'.confirm-dialog ','返回核对');
          assert.equal(await web('window.routingTrace.length'),0);
          await click(web,'dialog ','核对 SSH 指纹');
        }
        await click(web,'.confirm-dialog ','信任并继续');
      }
      await wait(web, 'window.routingTrace.join(",")==="A,' + peerRole + ',apply"');
      await web('delete window.devkitDesktop; delete window.devkitCollab; delete window.routingTrace; location.hash="relay"');
    }
    await web(portalTheme ? 'document.documentElement.dataset.theme=' + JSON.stringify(portalTheme) : 'delete document.documentElement.dataset.theme');
    await click(web, current, '原 IP 双向互通');
    await wait(web, 'document.body.innerText.includes("测试网络")');
    assert.equal(await web('document.body.innerText.includes("一键配置")'), false);
    browser.setBounds(routingBounds);
    await wait(web, '!document.querySelector("dialog[open]")');
    await captureRelay(browser, 'relay-plan');
    browser.setContentSize(390,740);
    await web('document.querySelectorAll(".relay-panels details").forEach(el => el.open=true)');
    await click(web,current,'检测双向互通');
    await wait(web,'document.querySelector(".relay-direction-results")?.textContent.includes("需要 SSH 终端权限")');
    assert.equal(await web('document.querySelector(".relay-workspace").scrollWidth <= document.querySelector(".relay-workspace").clientWidth + 1'), true);
    await desktop(`(async () => { const api=window.devkitCollab;
      const [first]=(await api.request('relay','list')).data;
      for (let i=1;i<64;i++) {
        const result=await api.request('relay','save',{ ...first, id:undefined, name:'跨网路由'.repeat(16) + i });
        if (result.error) throw Error(result.error);
      }
    })()`);
    for (const execute of [desktop,web]) {
      await wait(execute, 'document.querySelector(".relay-workspace select")?.options.length===64');
      await execute(`(() => { const el=document.querySelector('.relay-workspace select'); el.selectedIndex=63; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
      await wait(execute, 'document.querySelector(".relay-panels h3")?.textContent.endsWith("63")');
      assert.equal(await execute('!!document.querySelector(".relay-direction-results")'),false);
      assert.equal(await execute('document.querySelector(".relay-panels h3 .file-name").tabIndex'),0);
      await execute(`(() => { const button=[...document.querySelectorAll('.relay-panels button')].find(b=>b.textContent==='编辑'); button.focus(); button.click(); })()`);
      await wait(execute, '!!document.querySelector("dialog[open] .relay-addresses")');
      await checkRelayForm(execute);
      await execute('document.querySelector(\'dialog[open] [aria-label="关闭路由配置"]\').click()');
      await wait(execute, 'document.activeElement.textContent==="编辑" && !document.querySelector("dialog[open]")');
      assert.equal(await execute('document.querySelector(".relay-workspace").scrollWidth <= document.querySelector(".relay-workspace").clientWidth + 1'),true);
    }
    browser.setBounds(routingBounds);
    await desktop(`(async () => { const api=window.devkitCollab;
      for (const plan of (await api.request('relay','list')).data.filter(p => p.kind==='routing')) await api.request('relay','remove',plan);
    })()`);
    await click(web, current, '服务转发');
    await click(desktop, main, '服务转发');
    await click(desktop, main, '新建规则');
    await click(desktop, 'dialog ', '中转端 A');
    for (const [label, value] of [['服务名称','本机 HTTP'], ['目标服务地址','127.0.0.1'], ['目标 TCP 端口',port], ['B 可达的 A 监听 IPv4','127.0.0.1']])
      await fill(desktop, 'dialog input[aria-label="' + label + '"]', value);
    await click(desktop, 'dialog ', '保存并检测');
    await wait(desktop, 'document.body.innerText.includes("直达目标 · 可用")');
    assert.equal(await desktop('document.querySelector(".relay-result .primary-button")?.getAttribute("aria-label")'), '启动转发（直达目标）');
    await captureRelay(window, 'relay-service-results');
    await wait(web, 'document.body.innerText.includes("本机 HTTP")');
    await desktop(`(async () => {
      for (let i=1;i<64;i++) {
        const result = await window.devkitCollab.request('relay','save',{ name:'长名称'.repeat(25) + i, role:'A', target:'127.0.0.1', targetPort:80, bind:'127.0.0.1', listenPort:8080 });
        if (result.error) throw Error(result.error);
      }
    })()`);
    const chooseLast = `(() => { const el=document.querySelector('.relay-workspace select'); el.selectedIndex=63; el.dispatchEvent(new Event('change',{bubbles:true})); })()`;
    for (const execute of [desktop, web]) {
      await wait(execute, 'document.querySelector(".relay-workspace select")?.options.length===64');
      await execute(chooseLast);
      await wait(execute, 'document.querySelector(".relay-panels h3")?.textContent.endsWith("63")');
    }
    const bounds = browser.getBounds();
    browser.setContentSize(390, 740);
    await click(web, current, '编辑');
    await wait(web, '!!document.querySelector("dialog[open] .relay-field-pair")');
    await web('document.querySelectorAll("dialog[open] .relay-form details").forEach(el => el.open=true)');
    await checkRelayForm(web);
    await web('document.querySelector(\'dialog[open] [aria-label="关闭规则编辑"]\').click()');
    await wait(web, '!document.querySelector("dialog[open]")');
    await web('document.querySelector(".relay-panels details").open=true');
    await wait(web, 'document.body.innerText.includes("目标防火墙")');
    assert.equal(await web('document.querySelector(".relay-workspace").scrollWidth <= document.querySelector(".relay-workspace").clientWidth + 1'), true);
    browser.setBounds(bounds);
    await openWorkspace('局域网快传');
    await web('location.hash="transfer"');
    await click(web, current, '凭密码取件');
    assert.equal(await web('!!document.querySelector(".transfer-link-settings")'), false);
    assert.equal(await web('document.querySelector(' + JSON.stringify(current + '[aria-label="发送方式"] button[aria-pressed=true]') + ').value'), 'direct');
    await fill(web, current + 'input[aria-label="输入取件密码"]', 'bad');
    await click(web, current, '确认取件');
    await wait(web, 'document.body.innerText.includes("取件密码不正确")');
    assert.equal(await web('document.body.innerText.includes("跨设备取件测试")'), false);
    await fill(web, current + 'input[aria-label="输入取件密码"]', 'case-pass');
    await click(web, current, '确认取件');
    await wait(web, 'document.body.innerText.includes("跨设备取件测试")');
    // Send actual browser File objects in each direction, then read the downloaded bytes.
    async function exchange(send, sendScope, receive, receiveScope, receiverWindow, name, direct = false) {
      const bytes = [0, 255, 3, 9, 128];
      const exerciseResume = name === 'portal-to-desktop.bin';
      const length = exerciseResume ? 1048576 + 31 : direct ? 3 * 524288 + 31 : bytes.length;
      const content = Buffer.alloc(length);
      for (let i = 0; i < length; i++) content[i] = bytes[i % bytes.length];
      await selectMode(send, sendScope, direct ? 'direct' : 'stored');
      await send(`{ const input=document.querySelector(${JSON.stringify(sendScope + 'input[type=file]')}); const dt=new DataTransfer();
        const pattern=${JSON.stringify(bytes)};dt.items.add(new File([Uint8Array.from({length:${length}},(_,i)=>pattern[i%pattern.length])],${JSON.stringify(name)}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true})); }`);
      await fill(send, sendScope + '.collab-compose input[type=password]', 'file-pass');
      if (exerciseResume) await send(`{
        window.resumeOffsets = [];
        const fetch = window.fetch;
        window.restoreTransferFetch = () => { window.fetch = fetch; };
        window.fetch = async (...args) => {
          const response = await fetch(...args);
          if (String(args[0]).endsWith('/transfer/part')) {
            window.resumeOffsets.push(JSON.parse(args[1].body).offset);
            if (window.resumeOffsets.length === 1) throw new Error('测试连接中断');
          }
          return response;
        };
        void 0;
      }`);
      await click(send, sendScope, direct ? '发布直传文件（1）' : '发送所选内容（1）');
      if (exerciseResume) {
        await wait(send, "document.querySelector('.collab-pending small')?.textContent.includes('测试连接中断')");
        await wait(send, `[...document.querySelectorAll(${JSON.stringify(sendScope + '[role=status], ' + sendScope + '[role=alert]')})].filter(el=>el.textContent.includes('测试连接中断')).length === 1`);
        await click(send, sendScope, '发送所选内容（1）');
        await wait(send, 'window.resumeOffsets.length === 2');
        assert.deepEqual(await send('window.resumeOffsets'), [0, 1048576]);
        await send('window.restoreTransferFetch()');
      }
      const article = `[...document.querySelectorAll(${JSON.stringify(receiveScope + '.collab-entry')})].find(el=>el.innerText.includes(${JSON.stringify(name)}))`;
      try { await wait(receive, '!!' + article); }
      catch (error) {
        const diagnostics = await send(`[...document.querySelectorAll(${JSON.stringify(sendScope + '[role=alert], ' + sendScope + '[role=status]')})].map(el => el.textContent)`);
        throw new Error(error.message + ' · 发送端 ' + diagnostics.join(' / '));
      }
      const own = `[...document.querySelectorAll(${JSON.stringify(sendScope + '.collab-entry')})].find(el=>el.innerText.includes(${JSON.stringify(name)}))`;
      await wait(send, '!!' + own + '?.querySelector(".publisher-pickup button")');
      assert.equal(await receive('!!' + article + '.querySelector(".publisher-pickup")'), false);
      await send(own + '.querySelector(".publisher-pickup button").click()');
      await wait(send, own + '?.querySelector(".publisher-pickup code")?.textContent === "file-pass"');
      await send(own + '.querySelector(".publisher-pickup button").click()');
      await wait(send, '!' + own + '.querySelector(".publisher-pickup code")');
      await receive(article + '.querySelector("button").click()');
      await fill(receive, receiveScope + 'input[aria-label="输入取件密码"]', 'file-pass');
      if (direct) await click(receive, receiveScope, '确认取件');
      const saveButton = direct ? '保存直传文件' : '确认取件';
      const target = path.join(output, name);
      if (receiverWindow === window) {
        const originalDialog = dialog.showSaveDialog;
        try {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
          await click(receive, receiveScope, saveButton);
          await wait(
            receive,
            'document.querySelector(".workspace:not([hidden]) .collab-inbox").innerText.includes("文件已保存")',
          );
        } finally {
          dialog.showSaveDialog = originalDialog;
        }
      } else {
        const saved = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('File download timed out')), direct ? 45000 : 8000);
          receiverWindow.webContents.session.once('will-download', (_event, item) => {
            item.setSavePath(target);
            item.once('done', (_e, state) => {
              clearTimeout(timer);
              state === 'completed' ? resolve() : reject(new Error(state));
            });
          });
        });
        if (direct && !lan) await receive('window.showSaveFilePicker = undefined');
        await Promise.all([saved, click(receive, receiveScope, saveButton)]);
      }
      assert.deepEqual(await fs.readFile(target), content);
      await fs.unlink(target);
    }
    await exchange(desktop, main, web, current, browser, 'desktop-to-portal.bin');
    await exchange(web, current, desktop, main, window, 'portal-to-desktop.bin');
    const storage = path.join(process.env.DEVKIT_DEV_ROOT, 'configs', 'collaboration');
    const beforeDirect = await fs.readdir(storage);
    const beforeIndex = await fs.readFile(path.join(storage, 'transfer.json'), 'utf8');
    await exchange(desktop, main, web, current, browser, 'direct-desktop-to-web.bin', true);
    await exchange(web, current, desktop, main, window, 'direct-web-to-desktop.bin', true);
    const visitor = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true,
        backgroundThrottling: false,
        partition: 'collab-peer-' + Date.now(),
      },
    });
    try {
      const peer = (code) => visitor.webContents.executeJavaScript(code, true);
      await visitor.loadURL(address);
      await fill(peer, '.portal-login input[type=password]', settings.password);
      await click(peer, '.portal-login ', '登录');
      await wait(peer, '!!document.querySelector(".collab-compose")');
      await exchange(peer, current, web, current, browser, 'direct-between-guests.bin', true);
      await peer('location.reload()');
      await wait(web, '![...document.querySelectorAll(".collab-entry")].some(entry => entry.innerText.includes("direct-between-guests.bin"))');
    } finally {
      visitor.destroy();
    }
    assert.deepEqual(await fs.readdir(storage), beforeDirect);
    assert.equal(await fs.readFile(path.join(storage, 'transfer.json'), 'utf8'), beforeIndex);
    async function capture(name) {
      await web('new Promise(resolve => setTimeout(resolve, 450))');
      browser.webContents.invalidate();
      await web('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await fs.writeFile(path.join(output, name + '.png'), (await browser.webContents.capturePage()).toPNG());
    }
    await capture('collab-transfer');
    await web('location.hash="mock"');
    await click(web, current, '新建接口');
    await fill(web, current + '.collab-fields input', '订单列表');
    await web('document.querySelectorAll(' + JSON.stringify(current + '.collab-check input') + ')[1].click()');
    await click(web, current, '保存接口');
    await wait(web, '!!document.querySelector(".collab-url")');
    const url = await web('document.querySelector(".collab-url").textContent');
    const orders = (await (await fetch(url)).json()).items;
    assert.equal(orders.length, 5);
    assert.equal(typeof orders[0].amount, 'number');
    assert.notEqual(orders[0].id, (await (await fetch(url)).json()).items[0].id);
    await click(web, current, '响应配置');
    await wait(web, '!!document.querySelector(".mock-code-panel .cm-content")');
    await capture('collab-mock-editor');
    await click(web, current, '预览响应');
    await wait(web, 'document.querySelector(".mock-preview .cm-content")?.textContent.includes("customer")');
    await click(web, current, 'JSON 模板');
    await web('const preset = document.querySelector(".mock-generation select"); preset.value = "用户列表"; preset.dispatchEvent(new Event("change", {bubbles:true}))');
    await fill(web, current + '.mock-generation input', '3');
    await click(web, current, '保存接口');
    await wait(web, '!!document.querySelector(".mock-calls .collab-url")');
    const users = (await (await fetch(url)).json()).items;
    assert.deepEqual(users.map(user => user.id), [1, 2, 3]);
    assert.ok(users.every(user => user.email.includes('@')));
    await click(web, current, '响应配置');
    await fill(web, current + '[aria-label="查找接口"]', 'missing-endpoint');
    await wait(web, 'document.body.innerText.includes("没有匹配的接口")');
    await fill(web, current + '[aria-label="查找接口"]', '');
    const { newApiEndpoint } = await import('../shared/api-workspace.mjs');
    const library = async (action,input) => {
      const result = await desktop('window.devkitHttp.request('+JSON.stringify(action)+','+JSON.stringify(input || {})+')');
      assert.equal(result.error,undefined);
      return result.data.state;
    };
    const original = await library('get-library');
    const endpoint = {...newApiEndpoint('order_fixture'),name:'订单详情',path:'/orders/:id'};
    endpoint.responses[0].schema = JSON.stringify({$ref:'#/$defs/order',$defs:{order:{type:'object',properties:{id:{$ref:'#/$defs/id'},status:{enum:['new','paid']}}},id:{type:'integer',minimum:1}}});
    const fixture = {id:'mock_contract_fixture',name:'商城回归',description:'',version:'1',baseUrl:'http://localhost',groups:[],environments:[],endpoints:[endpoint]};
    const seeded = await library('save-library',{revision:original.revision,data:{...original,projects:[...original.projects,fixture]}});
    try {
      await web('document.querySelector(".mock-library-tools summary").click()');
      await click(web,current,'从 HTTP 工作台导入');
      await click(web,current,'商城回归 / 订单详情');
      await wait(web,'document.querySelector(".mock-response-bar button[value=schema]").getAttribute("aria-pressed")==="true"');
      await web('document.querySelector(".mock-fields-help summary").click()');
      await fill(web,current+'.mock-fields-help input','id');
      await click(web,current,'填入响应字段');
      await click(web,current,'预览响应');
      await wait(web,'document.querySelector(".mock-preview .cm-content")?.textContent.includes("42")');
      await web('document.querySelectorAll(".mock-publish input")[1].click()');
      await click(web,current,'保存接口');
      await wait(web,'!!document.querySelector(".mock-calls .collab-url")');
      const target = (await web('document.querySelector(".mock-calls .collab-url").textContent')).replace(/\/1$/, '/42')+'?page=2';
      assert.equal((await (await fetch(target)).json()).id,42);
      await wait(web,'document.querySelector(".mock-call summary")?.textContent.includes("page=2")');
      await web('document.querySelector(".mock-call summary").click()');
      await click(web,current,'带入 HTTP 调试');
      await wait(web,'[...document.querySelectorAll(".http-workbench:not([hidden]) input")].some(e=>e.value.includes("/42?page=2"))');
      await web('location.hash="mock"');
      await wait(web,'!!document.querySelector(".portal-page:not([hidden]) .mock-heading")');
      if (await web('!document.querySelector(".mock-library-tools").open')) await web('document.querySelector(".mock-library-tools summary").click()');
      await click(web,current,'新建项目数据集');
      await fill(web,current+'input[list="mock-project-names"]','商城回归');
      await fill(web,current+'.mock-route .collab-fields label:nth-child(3) input','/products');
      await web('document.querySelectorAll(".mock-publish input")[1].click()');
      await click(web,current,'保存接口');
      await wait(web,'document.querySelector(".mock-calls .collab-url")?.textContent.endsWith("/products")');
      const base = await web('document.querySelector(".mock-calls details .collab-url").textContent');
      assert.equal((await (await fetch(base+'/products')).json()).length,5);
      assert.equal((await (await fetch(base+'/orders/42')).json()).id,42);
      await click(web,current,'响应配置');
    } finally {
      await library('save-library',{revision:seeded.revision,data:{...original,revision:seeded.revision}});
    }
    await web('location.hash="whiteboard"');
    await fill(web, current + '[aria-label="新画板名称"]', '同步标注');
    await web(`(async () => {
      const sample = document.createElement('canvas');
      sample.width = 800; sample.height = 420;
      const ctx = sample.getContext('2d');
      ctx.fillStyle = '#edf2f7'; ctx.fillRect(0,0,800,420);
      ctx.fillStyle = '#284466'; ctx.fillRect(36,36,728,58);
      ctx.fillStyle = 'white'; ctx.font = '24px sans-serif'; ctx.fillText('订单详情',60,74);
      ctx.fillStyle = 'white'; ctx.fillRect(36,106,728,220);
      ctx.fillStyle = '#334155'; ctx.fillText('状态：等待确认',60,156);
      const png = await new Promise(resolve => sample.toBlob(resolve,'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([png],'订单详情.png',{type:'image/png'}));
      const picker = document.querySelector(${JSON.stringify(current + 'input[type=file]')}); picker.files=dt.files; picker.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await wait(
      web,
      `[...document.querySelectorAll(${JSON.stringify(current + 'button')})].some(b=>b.textContent==='导出 PNG' && !b.disabled)`,
    );
    await wait(web, '!!document.querySelector("canvas[aria-label=共享标注画布]")');
    const boardId = await web('location.hash.split("/")[1]');
    await web('document.querySelector(".board-library-bar button").click()');
    await fill(web, current + '[aria-label="查找白板"]', 'missing-board');
    await wait(web, 'document.body.innerText.includes("没有匹配的画板")');
    await fill(web, current + '[aria-label="查找白板"]', '');
    await web('document.querySelector(".board-library-bar button").click()');
    assert.ok(boardId);
    await web(`(() => {
      const canvas = document.querySelector('canvas[aria-label=共享标注画布]');
      const r = canvas.getBoundingClientRect();
      window.boardRect = { x: Math.round(r.left + r.width * .2), y: Math.round(r.top + r.height * .2) };
    })()`);
    const { x, y } = await web('window.boardRect');
    for (const event of [
      { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
      { type: 'mouseMove', x: x + 24, y: y + 20, modifiers: ['leftButtonDown'] },
      { type: 'mouseUp', x: x + 24, y: y + 20, button: 'left', clickCount: 1 },
    ])
      browser.webContents.sendInputEvent(event);
    await wait(
      web,
      'document.querySelector(".portal-page:not([hidden]) .board-editor details summary")?.textContent.includes("（1）")',
    );
    const board = await desktop(
      'window.devkitCollab.request("whiteboard","read",{id:' + JSON.stringify(boardId) + '})',
    );
    assert.equal(board.data.marks.length, 1);
    assert.equal(board.data.image, true);
    const pixels = await web(
      'Array.from(document.querySelector("canvas[aria-label=共享标注画布]").getContext("2d").getImageData(0,0,1,1).data)',
    );
    assert.deepEqual(pixels, [237, 242, 247, 255]);
    const canvasPixels = "document.querySelector('canvas[aria-label=共享标注画布]').toDataURL()";
    const annotated = await web(canvasPixels);
    await click(web, current, '原图对照');
    await fill(web, current + '[aria-label="原图对照分界"]', '100');
    await wait(web, "document.querySelector('.board-comparison output')?.textContent === '100%'");
    assert.notEqual(await web(canvasPixels), annotated);
    await click(web, current, '原图对照');
    await wait(web, canvasPixels + ' === ' + JSON.stringify(annotated));

    const exported = path.join(output, 'collab-export.png');
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PNG export timed out')), 8000);
      browser.webContents.session.once('will-download', (_event, item) => {
        item.setSavePath(exported);
        item.once('done', (_e, state) => {
          clearTimeout(timer);
          state === 'completed' ? resolve() : reject(new Error(state));
        });
      });
    });
    await Promise.all([done, click(web, current, '导出 PNG')]);
    const png = await fs.readFile(exported);
    assert.equal(png.readUInt32BE(16), 800);
    assert.equal(png.readUInt32BE(20), 420);
    await wait(web, 'document.querySelector(".portal-page:not([hidden]) h1")?.textContent==="截图协作白板"');
    await web('new Promise(resolve => setTimeout(resolve, 350))');
    browser.webContents.invalidate();
    await fs.writeFile(path.join(output, 'collab-whiteboard.png'), (await browser.webContents.capturePage()).toPNG());
    await web(
      '(() => { const theme = document.querySelector("[aria-label=共享页面主题]"); theme.value = "light"; theme.dispatchEvent(new Event("change", {bubbles:true})); })()',
    );
    await capture('collab-whiteboard-light');
    const libraryToggle = current + '.board-library-bar button';
    await web('document.querySelector(' + JSON.stringify(libraryToggle) + ').click()');
    await wait(web, '!!document.querySelector(".board-index .collab-record")');
    await web('document.querySelector(".board-index .collab-record").click()');
    await wait(web, '!document.querySelector(".board-library")');
    for (const width of [375, 390]) {
      browser.setContentSize(width, 844);
      await wait(web, 'innerWidth === ' + width);
      const toolbar = current + '.board-tools';
      const getTool = selector => 'document.querySelector(' + JSON.stringify(toolbar + ' ' + selector) + ')';
      const shape = getTool('select');
      for (const value of ['rect', 'ellipse']) {
        await web(`{const field=${shape};field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('change',{bubbles:true}));}`);
        await wait(web, shape + '.value === ' + JSON.stringify(value));
      }
      await web(getTool('[aria-label="画笔"]') + '.click()');
      await wait(web, shape + '.value === ""');
      await web(`{const field=${shape};field.value='ellipse';field.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await wait(web, shape + '.value === "ellipse"');
      assert.equal(await web(shape + '.getBoundingClientRect().top === ' + getTool('.board-undo') + '.getBoundingClientRect().top'), true);
      const point = await web(`(() => {
        const canvas=document.querySelector('canvas[aria-label=共享标注画布]');
        canvas.scrollIntoView({block:'center'});
        const r=canvas.getBoundingClientRect();
        return {x: Math.round(r.left+r.width*.3), y: Math.round(r.top+r.height*.3)};
      })()`);
      browser.webContents.sendInputEvent({type:'mouseDown', ...point, button:'left', clickCount:1});
      browser.webContents.sendInputEvent({type:'mouseMove', x:point.x+24, y:point.y+20, modifiers:['leftButtonDown']});
      browser.webContents.sendInputEvent({type:'mouseUp', x:point.x+24, y:point.y+20, button:'left', clickCount:1});
      await wait(web, 'document.querySelector(".board-editor details summary")?.textContent.includes("（2）")');
      const updated = await desktop('window.devkitCollab.request("whiteboard","read",{id:' + JSON.stringify(boardId) + '})');
      assert.equal(updated.data.marks.at(-1).tool, 'ellipse');
      await web(getTool('.board-undo') + '.click()');
      await wait(web, 'document.querySelector(".board-editor details summary")?.textContent.includes("（1）")');
    }
    assert.ok(await web('document.documentElement.scrollWidth <= innerWidth'));
    await wait(
      web,
      'document.querySelector(".board-editor canvas")?.getContext("2d").getImageData(0,0,1,1).data[0] === 237',
    );
    await capture('collab-whiteboard-mobile');
    await web('location.hash="mock"');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden]) .mock-code-panel")');
    assert.ok(await web('document.documentElement.scrollWidth <= innerWidth'));
    assert.equal(await web('document.querySelectorAll(".portal-context-row .portal-module-actions button").length'), 1);
    await click(web, '.portal-module-actions ', '邀请设备');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden]) #mock-invite")');
    await web('document.querySelector("#mock-invite").closest("dialog").querySelector("[aria-label=关闭邀请设备]").click()');
    await wait(web, '!document.querySelector("#mock-invite")');
    await capture('collab-mock-mobile');
    const directoryToggle = current + '.mock-directory-toggle';
    await web('document.querySelector(' + JSON.stringify(directoryToggle) + ').click()');
    await wait(web, '!!document.querySelector(".mock-layout .collab-rail").offsetWidth');
    await web('document.querySelector(".mock-layout .collab-record").click()');
    await wait(web, '!document.querySelector(".mock-layout .collab-rail").offsetWidth');
    await web('location.hash="transfer"');
    await wait(web, 'document.querySelector(".portal-page:not([hidden]) h1")?.textContent==="局域网快传"');
    assert.ok(await web('document.documentElement.scrollWidth <= innerWidth'));
    await click(web, current + '.transfer-switch ', '发送内容');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden]) .collab-compose").offsetWidth');
    for (const width of [375, 390]) {
      browser.setContentSize(width, 844);
      await wait(web, 'innerWidth === ' + width);
      for (const value of ['1', '168', '24']) {
        const segment = 'document.querySelector(' + JSON.stringify(current + '[aria-label="有效期"] button[value="' + value + '"]') + ')';
        const fits = await web(`(() => {
          const b=${segment}, r=b.getBoundingClientRect(), group=b.parentElement.getBoundingClientRect();
          return r.width>0 && r.left>=group.left && r.right<=group.right+1 && r.right<=innerWidth;
        })()`);
        assert.ok(fits, `Every expiry option fits at ${width}px`);
        await web(segment + '.click()');
        await wait(web, segment + '.getAttribute("aria-pressed") === "true"');
      }
    }
    await capture('collab-transfer-compose-mobile');
    const sendOffset = () => web(`(() => {
      const panel = document.querySelector("${current}.collab-compose");
      return panel.querySelector('.transfer-submit').getBoundingClientRect().top - panel.getBoundingClientRect().top;
    })()`);
    const widths = [1120, 390];
    const emptyOffsets = new Map();
    for (const width of widths) {
      browser.setContentSize(width, 844);
      await wait(web, 'innerWidth === ' + width);
      emptyOffsets.set(width, await sendOffset());
    }
    await web(`(() => {
      const input = document.querySelector('${current}.collab-compose input[type=file]');
      const dt = new DataTransfer();
      for (let i = 0; i < 95; i++) dt.items.add(new File(['x'], 'queue-' + i + '.txt'));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await wait(web, "document.querySelectorAll('.collab-pending > div').length === 30");
    for (const width of widths) {
      browser.setContentSize(width, 844);
      await wait(web, 'innerWidth === ' + width);
      assert.ok(Math.abs(await sendOffset() - emptyOffsets.get(width)) <= 1, 'Send stays in place at ' + width + 'px');
    }
    await web("document.querySelector('[aria-label=待发送文件分页] [aria-label=下一页]').click()");
    await wait(web, "!!document.querySelector('[aria-label=\"取消选择 queue-30.txt\"]')");
    await web(`document.querySelector('[aria-label="取消选择 queue-30.txt"]').click()`);
    await wait(web, "document.querySelector('.portal-page:not([hidden]) .send-summary')?.textContent.includes('94 个文件')");
    await click(web, current + '.transfer-switch ', '收件箱');
    await wait(web, '!!document.querySelector(".portal-page:not([hidden]) .collab-inbox").offsetWidth');
    await web('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(
      path.join(output, 'collab-transfer-mobile.png'),
      (await browser.webContents.capturePage()).toPNG(),
    );

    await desktop('window.devkitProjects.request("stop")');
    await openWorkspace('局域网快传');
    const quickSettings = main + '.collab-header .transfer-link-settings';
    const openQuickLinks = async () => {
      await desktop(`document.querySelector('${quickSettings} summary').click()`);
      await wait(desktop, `!!document.querySelector('${quickSettings}[open] input:not(:disabled)')`);
    };
    const closeQuickLinks = async () => {
      await desktop(`document.querySelector('${quickSettings} .floating-details-close').click()`);
      await wait(desktop, `document.activeElement === document.querySelector('${quickSettings} summary')`);
    };
    await openQuickLinks();
    await fill(desktop, '.transfer-link-settings input', String(port));
    await click(desktop, '.transfer-link-settings ', '保存端口');
    await wait(desktop, '!!document.querySelector(".transfer-port-links code")');
    const quick = await desktop('document.querySelector(".transfer-port-links code").textContent');
    assert.equal(quick, new URL(quick).origin, 'Only the LAN address and listening port are needed');
    window.focus();
    window.webContents.focus();
    await click(desktop, '.transfer-port-links ', '复制链接');
    await wait(desktop, 'document.querySelector(".transfer-link-settings").innerText.includes("已复制快速链接")');
    assert.equal(await clipboard.readText(), quick);
    await closeQuickLinks();
    await browser.webContents.session.setProxy({ mode: 'direct' });
    await browser.loadURL(quick);
    const standalone = '.transfer-link-page .collab-page ';
    await wait(web, '!!document.querySelector(".transfer-link-page .collab-entry")');
    assert.equal(await web('document.querySelector("h1").innerText'), '局域网快传');
    assert.equal(await web('!!document.querySelector(".portal-login, .transfer-link-settings")'), false);
    await exchange(web, standalone, desktop, main, window, 'quick-to-desktop.bin');
    await browser.loadURL(quick);
    const sentFile = "[...document.querySelectorAll('.collab-entry')].find(el => el.innerText.includes('quick-to-desktop.bin'))";
    await wait(web, '!!' + sentFile + '?.querySelector(".publisher-pickup button")');
    assert.equal(await web('!!' + sentFile + '.querySelector(".publisher-pickup code")'), false);
    await web(sentFile + '.querySelector(".publisher-pickup button").click()');
    await wait(web, sentFile + '?.querySelector(".publisher-pickup code")?.textContent === "file-pass"');
    await web(sentFile + '.querySelector(".publisher-pickup button").click()');
    await exchange(desktop, main, web, standalone, browser, 'desktop-to-quick-stored.bin');
    await exchange(desktop, main, web, standalone, browser, 'desktop-to-quick.bin', true);
    await openQuickLinks();
    assert.equal(await desktop(`document.querySelector('${quickSettings} input').value`), String(port));
    await fill(desktop, '.transfer-link-settings input', '');
    await click(desktop, '.transfer-link-settings ', '保存端口');
    await wait(desktop, '!document.querySelector(".transfer-port-links code")');
    await closeQuickLinks();
  } finally {
    browser.destroy();
    await desktop('window.devkitProjects.request("stop")');
  }
  console.log(
    'Desktop, portal and independent quick-link transfers, Mock response, shared canvas drawing and mobile layout passed.',
  );
};
