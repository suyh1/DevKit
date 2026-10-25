const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkNginxDock(window, output) {
  const js = source => window.webContents.executeJavaScript(source);
  const settle = () => new Promise(resolve => setTimeout(resolve, 320));
  async function wait(expression) {
    for (let attempt = 0; attempt < 120; attempt++) { if (await js(expression)) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    throw new Error(`Sticky controls condition failed: ${expression}`);
  }
  const size = window.getSize(), report = [];
  await js(`window.__ngDockDetails=[...document.querySelectorAll('.ng-block')].map(element=>({element,open:element.open}));document.querySelectorAll('.ng-block').forEach(element=>element.open=true)`);
  try {
    for (const width of [1440, 1024, 390]) {
      window.setContentSize(width, width === 390 ? 780 : 980); await settle();
      for (const theme of ['light', 'dark']) {
        await js(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.nginx-workspace').scrollTop=0`);
        await wait('document.querySelector(".ng-control-dock")?.dataset.stuck === "false"'); await settle();
        const expandedHeight = await js('document.querySelector(".ng-control-dock").getBoundingClientRect().height');
        await js(`{const root=document.querySelector('.nginx-workspace'),anchor=document.querySelector('.ng-dock-anchor');root.scrollTop=anchor.getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop+130;}`);
        await wait('document.querySelector(".ng-control-dock")?.dataset.compact === "true"'); await settle();
        const first = await js(`(()=>{const dock=document.querySelector('.ng-control-dock'),root=document.querySelector('.nginx-workspace'),bar=document.querySelector('.ng-toolbar'),d=dock.getBoundingClientRect(),r=root.getBoundingClientRect(),b=bar.getBoundingClientRect();return {top:d.top,bottom:d.bottom,height:d.height,left:d.left,right:d.right,rootTop:r.top,rootContentTop:r.top+parseFloat(getComputedStyle(root).paddingTop),rootBottom:r.bottom,barTop:b.top,barBottom:b.bottom,scroll:root.scrollTop};})()`);
        const ancestors = await js(`(()=>{let node=document.querySelector('.ng-control-dock');const rows=[];while(node){const s=getComputedStyle(node),r=node.getBoundingClientRect();rows.push({class:node.className,overflow:s.overflow,position:s.position,top:r.top,height:r.height,scrollTop:node.scrollTop,scrollHeight:node.scrollHeight,padding:s.paddingTop,transform:s.transform});node=node.parentElement}return rows})()`);
        await fs.writeFile(path.join(output, 'nginx-sticky-debug.json'), JSON.stringify({ width, expandedHeight, ...first, ancestors }, null, 2));
        assert.ok(Math.abs(first.top - first.rootContentTop) <= 2, `${width}: dock sticks below workbench navigation with workspace padding`);
        assert.ok(first.height < expandedHeight, `${width}: compact dock saves editor space`);
        assert.ok(first.barTop >= first.rootTop && first.barBottom <= first.rootBottom, `${width}: actions remain visible`);
        assert.ok(first.left >= 0 && first.right <= width + 1, `${width}: dock fits viewport`);
        await js('document.querySelector(".nginx-workspace").scrollTop += 160'); await settle();
        const secondTop = await js('document.querySelector(".ng-control-dock").getBoundingClientRect().top');
        assert.ok(Math.abs(secondTop - first.top) <= 2, `${width}: scrolling the config does not move controls`);
        if (await js('!!document.querySelector(".ng-output")')) {
          assert.equal(await js('document.querySelector(".ng-output").open'), false, 'Previous result is summarized on stick');
          await js('document.querySelector(".ng-output summary").click()'); await wait('document.querySelector(".ng-output").open'); await settle();
          assert.ok(await js('document.querySelector(".ng-output-body").getBoundingClientRect().height<=151'));
        }
        await fs.writeFile(path.join(output, `nginx-sticky-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
        await js('document.querySelector(".ng-dock-toggle").click()'); await wait('document.querySelector(".ng-control-dock").dataset.compact === "false"'); await settle();
        assert.equal(await js('document.querySelector(".ng-dock-metadata").inert'), false);
        await js('document.querySelector(".ng-dock-toggle").click()'); await wait('document.querySelector(".ng-control-dock").dataset.compact === "true"'); await settle();
        await js(`{const input=document.querySelector('.ng-argument input');input.scrollIntoView({block:'start'});input.focus();}`); await settle();
        const focus = await js(`({field:document.querySelector('.ng-argument input').getBoundingClientRect().top,dock:document.querySelector('.ng-control-dock').getBoundingClientRect().bottom})`);
        assert.ok(focus.field >= focus.dock - 2, `${width}: scrolled field is not covered by dock`);
        if (width === 390) {
          await js(`[...document.querySelectorAll('.ng-toolbar button')].find(button=>button.textContent.trim()==='重新读取').focus()`); await settle();
          assert.equal(await js('(()=>{const r=document.activeElement.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})()'), true, 'Keyboard reveals narrow action groups');
          await js('document.activeElement.blur()');
        }
        report.push({ width, theme, ...first, editorFieldUncovered: true });
      }
    }
    window.webContents.debugger.attach('1.3');
    try {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.equal(await js('getComputedStyle(document.querySelector(".ng-dock-metadata")).transitionDuration'), '0s');
      assert.equal(await js('getComputedStyle(document.querySelector(".ng-output-body")).animationName'), 'none');
    } finally {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); window.webContents.debugger.detach();
    }
    await fs.writeFile(path.join(output, 'nginx-sticky-report.json'), JSON.stringify(report, null, 2));
    console.log('Nginx sticky controls passed: stable actions and feedback, compact/expanded details, editor focus clearance, three widths, both themes, keyboard and reduced motion.');
  } finally {
    await js(`window.__ngDockDetails?.forEach(({element,open})=>element.open=open);delete window.__ngDockDetails;document.querySelector('.nginx-workspace').scrollTop=0;document.documentElement.dataset.theme='light'`);
    window.setSize(...size); await settle();
  }
};
