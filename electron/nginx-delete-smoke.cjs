const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkDeletion(window, output, { instanceId, createdId, createdDirectory, main, common, executable, port }) {
  const js = source=>window.webContents.executeJavaScript(source);
  async function wait(expression){for(let n=0;n<150;n++){if(await js(expression))return;await new Promise(resolve=>setTimeout(resolve,40));}throw new Error(`Deletion condition failed: ${expression}`);}
  async function ipc(action,payload){const response=await js(`window.devkitNginx.request(${JSON.stringify(action)},${JSON.stringify(payload)})`);assert.equal(response.error,undefined,response.error);return response.data;}
  async function click(text,root){await js(`[...document.querySelectorAll(${JSON.stringify(root+' button')})].find(button=>button.textContent.trim()===${JSON.stringify(text)}).click()`);await js('new Promise(resolve=>requestAnimationFrame(()=>resolve()))');await wait('!document.querySelector(".ng-busy")');}
  const state=await ipc('get'),created=state.instances.find(instance=>instance.id===createdId);
  const thirdMain=path.join(createdDirectory,'third.conf');await fs.writeFile(thirdMain,'worker_processes 1; pid logs/third.pid; events { worker_connections 32; }\n');
  const registered=await ipc('upsert',{revision:state.revision,instance:{...created,id:undefined,name:'备用实例',main:thirdMain}});
  const thirdId=registered.instances.at(-1).id;
  await click('刷新','.ng-heading');
  const documents=[main,common,created.main,...created.files,thirdMain],before=await Promise.all(documents.map(file=>fs.readFile(file)));
  const backupDirectory=path.join(state.directory,'backups'),backups=await fs.readdir(backupDirectory);
  let launched=false;
  try{
    if(executable){await click('启动','.ng-toolbar');await wait('document.querySelector(".ng-instance-heading .ng-status")?.textContent.includes("运行中")');launched=true;}
    await js(`{const input=[...document.querySelectorAll('.ng-argument input')].find(input=>input.getAttribute('aria-label').startsWith('proxy_pass 第'));input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'http://127.0.0.1:9009');input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();}`);
    await wait('document.querySelector(".ng-control-dock .ng-warning")?.textContent.includes("未保存")');
    assert.equal(await js('[...document.querySelectorAll(".ng-instance-heading button")].find(button=>button.textContent.trim()==="删除实例").disabled'),false,'Unsaved changes do not disable deletion');
    await click('删除实例','.ng-instance-heading');await wait('document.querySelector(".confirm-dialog")?.textContent.includes("未保存")');
    await fs.writeFile(path.join(output,'nginx-delete-confirmation.png'),(await window.webContents.capturePage()).toPNG());
    await click('取消','.confirm-dialog');await wait('!document.querySelector(".confirm-dialog[open]")');
    assert.equal((await ipc('get')).instances.length,3);
    assert.equal(await js('[...document.querySelectorAll(".ng-argument input")].find(input=>input.getAttribute("aria-label").startsWith("proxy_pass 第")).value'),'http://127.0.0.1:9009');
    await js(`document.querySelector('[data-instance-id="${instanceId}"] .ng-instance-delete').click()`);await wait('!!document.querySelector(".confirm-dialog[open]")');
    assert.equal(await js('document.querySelector(".confirm-dialog").textContent.includes("未保存")'),false,'Deleting another instance preserves the current draft');
    await click('删除实例','.confirm-dialog');await wait(`!document.querySelector('[data-instance-id="${instanceId}"]')`);
    assert.equal(await js(`document.querySelector('.ng-instances>.ng-help').textContent.includes(${JSON.stringify(state.directory)})`),true,'Deletion retains runtime storage metadata');
    assert.equal(await js('[...document.querySelectorAll(".ng-argument input")].find(input=>input.getAttribute("aria-label").startsWith("proxy_pass 第")).value'),'http://127.0.0.1:9009');
    await click('删除实例','.ng-instance-heading');await wait('!!document.querySelector(".confirm-dialog[open]")');await click('删除实例','.confirm-dialog');
    await wait('document.querySelector(".ng-instance-heading h2")?.textContent.includes("备用实例")');
    assert.equal(await js('!!document.querySelector(".ng-control-dock .ng-warning")'),false,'Deleting selected instance clears its discarded draft');
    assert.equal((await ipc('get')).instances.length,1);
    if(executable)assert.match(await(await fetch(`http://127.0.0.1:${port}/`,{headers:{Connection:'close'}})).text(),/Nginx ready/,'Deleting the record does not stop nginx');
    for(let i=0;i<documents.length;i++)assert.deepEqual(await fs.readFile(documents[i]),before[i],'Deletion retains main and shared files byte-for-byte');
    assert.deepEqual(await fs.readdir(backupDirectory),backups,'Deletion retains backups');
    await click('删除实例','.ng-instance-heading');await wait('!!document.querySelector(".confirm-dialog[open]")');await click('删除实例','.confirm-dialog');
    await wait('document.querySelector(".ng-empty h2")?.textContent==="尚未添加 Nginx 实例"');assert.equal((await ipc('get')).instances.length,0);
    await fs.writeFile(path.join(output,'nginx-deleted-empty.png'),(await window.webContents.capturePage()).toPNG());
    await click('添加实例','.ng-heading');await wait('!!document.querySelector(".ng-form-modal[open]")');
    assert.equal(await js('document.querySelector(".ng-form-modal select").value'),process.platform==='win32'?'win32':'linux','Deleting the last instance retains the host-platform default');
    await click('取消','.ng-form-modal');await wait('!document.querySelector(".ng-form-modal[open]")');
    console.log('Nginx deletion passed: visible list/header actions, dirty cancel, nonselected deletion retains draft, selected deletion switches neighbor, final empty state, files/backups preserved and running nginx stays alive.');
  }finally{
    if(launched){const {runNginx,nginxArgs}=await import('../server/nginx-process.mjs');const stopped=await runNginx(executable,nginxArgs(created,'stop'),created.prefix);assert.equal(stopped.ok,true,stopped.output);}
    const remaining=await ipc('get');if(remaining.instances.some(instance=>instance.id===thirdId))await ipc('remove',{id:thirdId,revision:remaining.revision,forgetOnly:true});
  }
};
