const assert = require('node:assert/strict');
const { clipboard } = require('electron');
module.exports = async function analysisWorkflows(window) {
  window.show();
  window.focus();
  window.webContents.focus();
  const { openTool, catalog } = require('./navigation-helpers.cjs')(window),
    entries = await catalog();
  const js = (code) => window.webContents.executeJavaScript(code, true),
    pane = '.task-pane:not([hidden])';
  const find = (s) => 'document.querySelector(' + JSON.stringify(pane + ' ' + s) + ')';
  async function wait(label, check) {
    for (let i = 0; i < 150; i++) {
      if (await js(check)) return;
      await new Promise((resolve) => setTimeout(resolve, 70));
    }
    throw Error(label + ' · ' + (await js(find('[role="alert"]') + '?.innerText ?? ""')));
  }
  async function open(id) {
    await js('[...document.querySelectorAll(".tab-close")].reverse().forEach(b=>b.click())');
    await openTool(entries.find((e) => e.id === id).name);
    await wait(id, find('h1') + '?.textContent === ' + JSON.stringify(entries.find((e) => e.id === id).name));
  }
  const clickLabel = (parent, label) =>
    js(
      '[...' +
        find(parent) +
        '.querySelectorAll("button")].find(b=>(b.getAttribute("aria-label") || b.textContent.trim())===' +
        JSON.stringify(label) +
        ').click()',
    );
  async function fill(selector, value) {
    await js(
      '(' +
        ((s, v) => {
          const el = document.querySelector(s);
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }).toString() +
        ')(' +
        JSON.stringify(pane + ' ' + selector) +
        ',' +
        JSON.stringify(value) +
        ')',
    );
  }
  await open('json-csv');
  const records = Array.from({ length: 52 }, (_, i) => ({ id: i, name: i === 51 ? '长文本'.repeat(100) : '简短值' }));
  await wait('JSON 输入编辑器', '!!' + find('.input-card .cm-content'));
  await js(find('.input-card .cm-content') + '.focus()');
  await window.webContents.insertText(JSON.stringify(records));
  await js(find('.run-button') + '.click()');
  const nextPage = find('.analysis-data [aria-label=下一页]');
  await wait('表格分页', nextPage + ' && !' + nextPage + '.disabled');
  await js(nextPage + '.click()');
  const inline = find('.analysis-row-toggle[aria-expanded]'), long = find('.analysis-row-toggle[aria-haspopup=dialog]');
  const size = window.getSize(), minimum = window.getMinimumSize();
  try {
    window.setMinimumSize(360, 600);
    for (const width of [1340, 390]) {
      window.setContentSize(width, 844);
      await wait('窗口调整宽度', width < 500 ? 'innerWidth < 450' : 'innerWidth > 1200');
      await js(inline + '.focus();' + inline + '.click()');
      await wait('简短记录在行下展开', find('tr.analysis-row-detail') + '?.innerText.includes("简短值") && document.activeElement === ' + inline);
      assert.equal(await js('!!document.querySelector("dialog[open]")'), false);
      await js(inline + '.click()');
      await js(long + '.focus();' + long + '.click()');
      await wait('长记录的完整内容', find('dialog[open] .analysis-row-detail') + '?.textContent.includes(' + JSON.stringify(records[51].name) + ')');
      await js(find('button[aria-label=关闭记录详情]') + '.click()');
      await wait('返回原记录与页码', 'document.activeElement === ' + long + ' && ' + long + '.textContent === "51"');
    }
  } finally {
    window.setSize(...size);
    window.setMinimumSize(...minimum);
  }
  for (const [id, expected] of Object.entries({
    diff: '冲突',
    json: '"patch"',
    yaml: 'ports',
    sql: 'INSERT INTO',
    'http-code': 'fetch(',
    timestamp: '97200000',
    cron: '2026-11-01T06:30',
    uuid: '-',
    'css-unit': 'clamp(',
    'geo-coordinates': '距离（米）',
  })) {
    await open(id);
    const parent = '[data-upgrade="' + id + '"]';
    await js(find(parent) + '.open=true');
    await clickLabel(parent, '填入示例');
    await clickLabel(parent, '运行');
    await wait(
      id + ' 结果',
      find(parent) + '.innerText.includes(' + JSON.stringify(expected) + ') && !!' + find(parent + ' pre'),
    );
    if (id === 'json') {
      await wait('三份 JSON 文档可编辑', find(parent) + '.querySelectorAll(".cm-content[contenteditable=true]").length === 3');
      await clickLabel(parent, '应用已有补丁');
      await wait('补丁编辑器', '!!' + find(parent + ' [role=textbox][aria-label="JSON Patch"]'));
      await clickLabel(parent, '填入示例');
      await clickLabel(parent, '运行');
      await wait('补丁应用到预演文档', find(parent + ' pre') + '?.textContent.includes(\'"state": "closed"\')');
      assert.equal(await js(find(parent) + '.querySelectorAll(".cm-content[contenteditable=true]").length'), 2);
    }
    if (id === 'diff') {
      await js(find(parent + ' input[type=radio]') + '.click()');
      await wait(
        '已解决冲突',
        '[...' +
          find(parent) +
          '.querySelectorAll("button")].some(b=>b.textContent==="复制结果"&&!b.disabled)',
      );
      await clickLabel(parent, '复制结果');
      for (let i = 0; i < 80 && !/原文/.test(await clipboard.readText()); i++)
        await new Promise((r) => setTimeout(r, 40));
      assert.match(await clipboard.readText(), /原文/);
    }
    console.log('Validated upgrade ' + id);
  }
  await open('regex');
  let parent = '[data-upgrade=regex]';
  await js(find(parent) + '.open=true');
  await clickLabel(parent, '新增样例');
  await fill(parent + ' textarea', 'dev@example.com');
  await fill(parent + ' label:nth-of-type(2) textarea', 'dev@example.com');
  await wait('自动运行正则样例', find(parent) + '.innerText.includes("通过")');
  await clickLabel(parent, '保存样例');
  await fill('.field-pattern input', 'nomatch');
  await wait('失配即时反馈', find(parent) + '.innerText.includes("失败")');
  await open('base64');
  parent = '[data-upgrade=base64]';
  await js(find(parent) + '.open=true');
  await js(
    '{const f=' +
      find(parent + ' input[type=file]') +
      ';const t=new DataTransfer();t.items.add(new File([new Uint8Array([0,255,128])],"example.bin"));f.files=t.files;f.dispatchEvent(new Event("change",{bubbles:true}));}',
  );
  await wait('编码精确保留字节', find(parent + ' textarea') + '.value.endsWith("AP+A")');
  await open('qr-code');
  await js(find('[data-file-tool=qr-code]') + '.closest("details").querySelector("summary").click()');
  await wait('二维码图片工具已打开', find('[data-file-tool=qr-code]') + '.closest("[popover]").matches(":popover-open")');
  const qr = require('qrcode-generator')(0, 'M');
  qr.addData('local-qr-check');
  qr.make();
  const bits = Array.from({ length: qr.getModuleCount() }, (_, i) =>
    Array.from({ length: qr.getModuleCount() }, (_, j) => qr.isDark(i, j)),
  );
  await js(
    '(async()=>{const bits=' +
      JSON.stringify(bits) +
      ';const c=document.createElement("canvas");c.width=c.height=(bits.length+8)*6;const ctx=c.getContext("2d");ctx.fillStyle="white";ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="black";bits.forEach((r,i)=>r.forEach((v,j)=>{if(v)ctx.fillRect((j+4)*6,(i+4)*6,6,6)}));const dt=new DataTransfer();dt.items.add(new File([await new Promise(r=>c.toBlob(r))],"qr.png",{type:"image/png"}));' +
      find('[data-file-tool=qr-code]') +
      '.dispatchEvent(new ClipboardEvent("paste",{clipboardData:dt,bubbles:true}));})()',
  );
  await clickLabel('[data-file-tool=qr-code]', '开始处理');
  await wait('截图解码', find('[data-file-tool=qr-code]') + '.innerText.includes("local-qr-check")');
  await open('mermaid-diagram');
  // Drive the editor through the same sample/run actions as a normal task.
  await js(
    '[...' +
      find('.input-card') +
      '.querySelectorAll("button")].find(b=>b.textContent.includes("示例")).click()',
  );
  await js(find('.run-button') + '.click()');
  await wait('Mermaid 已绘制', find('img[alt="Mermaid 图"]') + '?.naturalWidth > 0');
  for (const [source, valid] of [
    ['sequenceDiagram\n  A->>B: 订单', true],
    ['erDiagram\n  USER ||--o{ ORDER : places', true],
    ['flowchart LR\n A --[', false],
  ]) {
    const selector = pane + ' input[aria-label="选择输入文件"]';
    await js(
      '(' +
        ((selector, source) => {
          const el = document.querySelector(selector),
            dt = new DataTransfer();
          dt.items.add(new File([source], 'diagram.mmd'));
          el.files = dt.files;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }).toString() +
        ')(' +
        JSON.stringify(selector) +
        ',' +
        JSON.stringify(source) +
        ')',
    );
    await wait('已导入 Mermaid 源码', find('.status-stale') + '!==null');
    await js(find('.run-button') + '.click()');
    await wait(
      'Mermaid 渲染状态',
      valid ? find('img[alt="Mermaid 图"]') + '?.naturalWidth>0' : find('.status-error') + '!==null',
    );
  }
  await open('encoding-repair');
  await require('./analysis-file-smoke.cjs')(window, pane, 'encoding-repair');
  const root = find('[data-file-tool=encoding-repair]');
  await js(
    '{const s=' +
      root +
      '.querySelectorAll("select")[1];s.value="gb18030";s.dispatchEvent(new Event("change",{bubbles:true}));}',
  );
  await clickLabel('[data-file-tool=encoding-repair]', '开始处理');
  await wait('GB18030 编码副本', root + '.innerText.includes("下载结果")');

  await open('color-contrast');
  await js(find('.color-workbench details') + '.open=true');
  for (const color of ['#000000', '#FFFFFF']) {
    await fill('.color-value-input', color);
    await clickLabel('.color-workbench', '收藏主颜色');
  }
  await wait('黑白收藏色 WCAG', find('.color-workbench details') + '.innerText.includes("21.00 · AAA")');

  await open('hash');
  await js(find('.checksum-panel') + '.open=true');
  async function directory(map) {
    await js(
      '(' +
        ((s, map) => {
          const field = document.querySelector(s),
            dt = new DataTransfer();
          for (const [path, text] of Object.entries(map)) {
            const f = new File([text], path.split('/').at(-1));
            Object.defineProperty(f, 'webkitRelativePath', { value: 'root/' + path });
            dt.items.add(f);
          }
          field.files = dt.files;
          field.dispatchEvent(new Event('change', { bubbles: true }));
        }).toString() +
        ')(' +
        JSON.stringify(pane + ' input[webkitdirectory]') +
        ',' +
        JSON.stringify(map) +
        ')',
    );
  }
  await directory({ 'a/x.txt': 'one', 'b/x.txt': 'two' });
  await wait('目录相对路径', find('.checksum-panel') + '.innerText.includes("b/x.txt")');
  await clickLabel('.checksum-panel', '将当前目录设为对照基准');
  await directory({ 'a/x.txt': 'changed', 'c/x.txt': 'new' });
  await wait(
    '目录增删改',
    ['清单不一致', '清单未列出', '缺少文件 · b/x.txt']
      .map((t) => find('.checksum-panel') + '.innerText.includes(' + JSON.stringify(t) + ')')
      .join('&&'),
  );

  await open('json');
  const library = '.recipe-panel';
  await js(
    'localStorage.setItem("devkit:recipe:历史流程", JSON.stringify([{tool:"json",options:{mode:"format",indent:"2"}},{tool:"base64",options:{mode:"encode"}}]))',
  );
  await js(find(library) + '.open=true');
  await wait('配方加载', find('.recipe-actions') + '!==null');
  await js(
    '{const s=' +
      find('.recipe-library select') +
      ';s.value="历史流程";s.dispatchEvent(new Event("change",{bubbles:true}));}',
  );
  await wait(
    '旧格式配方迁移',
    'document.querySelectorAll(' + JSON.stringify(pane + ' .recipe-step') + ').length===2',
  );
  await js(find('.recipe-panel fieldset details') + '.open=true');
  await clickLabel(library, '新增样例');
  await fill('.recipe-panel details label textarea', '{}');
  await fill('.recipe-panel details label:nth-of-type(2) textarea', 'e30=');
  await clickLabel(library, '新增样例');
  await fill('.recipe-panel details fieldset:nth-of-type(2) label textarea', 'invalid');
  await fill('.recipe-panel details fieldset:nth-of-type(2) label:nth-of-type(2) textarea', '{}');
  await fill('.recipe-save input', '回归检查');
  await clickLabel(library, '保存流程');
  await js(
    '{const s=' +
      find('.recipe-library select') +
      ';s.value="回归检查";s.dispatchEvent(new Event("change",{bubbles:true}));}',
  );
  await clickLabel(library, '运行全部样例');
  await wait(
    '配方通过与指定步骤失败',
    find('.recipe-panel pre[role=status]') +
      '.textContent.includes("通过") && ' +
      find('.recipe-panel pre[role=status]') +
      '.textContent.includes("样例 2 · 步骤 1")',
  );

  console.log(
    'Verified merge selections, typed data conversion, two DST folds, regression cases, binary and QR inputs, and offline rendering.',
  );
};
