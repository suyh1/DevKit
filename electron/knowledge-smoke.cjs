const assert = require('node:assert/strict');

module.exports = async function knowledgeSmoke(desktop, portal, wait) {
  const local = (code) => desktop.webContents.executeJavaScript(code, true);
  const web = (code) => portal.webContents.executeJavaScript(code, true);
  const click = (run, root, name) =>
    run(
      `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(b=>b.textContent.trim()===${JSON.stringify(name)}).click()`,
    );
  await require('./navigation-helpers.cjs')(desktop).openWorkspace('团队知识库');
  await wait(desktop.webContents, 'document.querySelector(".kb-header .run-button")?.disabled === false');
  await click(local, '.kb-header', '新建文档');
  await wait(desktop.webContents, '!!document.querySelector("dialog[open] .kb-picker")');
  await local(
    `{const input=document.querySelector('dialog[open] input[data-modal-focus]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'网关部署与验证'); input.dispatchEvent(new Event('input',{bubbles:true}));}`,
  );
  for (const kind of ['jar', 'nginx']) {
    await local(
      `{const select=document.querySelector('.kb-picker select');select.value=${JSON.stringify(kind)};select.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await wait(desktop.webContents, "document.querySelectorAll('.kb-picker select')[1]?.options.length > 1");
    await local(
      `{const select=document.querySelectorAll('.kb-picker select')[1]; select.selectedIndex=1;select.dispatchEvent(new Event('change',{bubbles:true}));}`,
    );
    await wait(
      desktop.webContents,
      `document.querySelector('.kb-source').value.includes(${JSON.stringify('](#' + kind + '/')})`,
    );
  }
  await click(local, 'dialog[open]', '保存文档');
  await wait(desktop.webContents, "document.querySelectorAll('.kb-reader .kb-prose a').length === 2");
  const url = await local('location.hash');
  await web('location.hash = ' + JSON.stringify(url));
  await wait(portal.webContents, "document.querySelector('.kb-reader h2')?.textContent === '网关部署与验证'");
  assert.equal(await web("!!document.querySelector('.kb-header .run-button')"), false);
  assert.equal(
    await web(
      "document.querySelector('.kb-center').scrollWidth <= document.querySelector('.kb-center').clientWidth",
    ),
    true,
  );
  for (const kind of ['jar', 'nginx']) {
    await web(`document.querySelector('.kb-prose a[href^="#${kind}/"]').click()`);
    const target = kind === 'jar' ? '.jar-instance[data-linked=true]' : '.ng-center';
    await wait(
      portal.webContents,
      `location.hash.startsWith('#${kind}/') && document.querySelector(${JSON.stringify(target)})?.getClientRects().length > 0`,
    );
    if (kind === 'jar')
      await web("document.querySelector('.jar-instance[data-linked=true] details').open=true");
    await wait(
      portal.webContents,
      `[...document.querySelectorAll('${target} button')].some(b=>b.textContent==='关联手册' && b.getClientRects().length)`,
    );
    await click(web, target, '关联手册');
    await wait(
      portal.webContents,
      "location.hash.includes('related') && document.querySelector('.kb-cards')?.children.length === 1 && document.querySelector('.kb-reader h2')?.textContent === '网关部署与验证'",
    );
  }
  console.log(
    'Team knowledge passed desktop Markdown editing, optional JAR/Nginx links, mobile read-only access and reverse lookup from both instances.',
  );
};
