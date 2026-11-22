const assert = require('node:assert/strict');
const { rootCertificates } = require('node:tls');
const { nativeImage } = require('electron');
async function fixture(id) {
  if (id === 'cert-inspect') return ['issuer.pem', Buffer.from(rootCertificates[0]), 'SHA-256'];
  if (id === 'parquet-view') {
    const { parquetWriteBuffer } = await import('hyparquet-writer');
    return [
      'orders.parquet',
      Buffer.from(
        parquetWriteBuffer({
          columnData: [
            { name: '订单', type: 'STRING', data: ['001', '002'] },
            { name: '金额', type: 'INT32', data: [12, 24] },
          ],
        }),
      ),
      '2 行',
    ];
  }
  if (id === 'excel-inspect') {
    const Excel = require('exceljs'),
      book = new Excel.Workbook(),
      sheet = book.addWorksheet('订单');
    sheet.addRow(['单价', '数量', '金额']);
    sheet.getCell('A2').value = 12;
    sheet.getCell('B2').value = 2;
    sheet.getCell('C2').value = { formula: 'A2*B2', result: 24 };
    book.addWorksheet('映射').state = 'hidden';
    return ['orders.xlsx', await book.xlsx.writeBuffer(), 'A2*B2'];
  }
  if (['jar-inspect', 'zip-inventory'].includes(id)) {
    const Zip = require('jszip'),
      zip = new Zip();
    zip.file('META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\r\nMain-Class: demo.Main\r\n');
    zip.file('lib/a.jar', '');
    zip.file('a/main.txt', 'left');
    zip.file('b/main.txt', 'right');
    return [
      'demo.' + (id === 'jar-inspect' ? 'jar' : 'zip'),
      await zip.generateAsync({ type: 'nodebuffer' }),
      'main.txt',
    ];
  }
  if (id === 'encoding-repair') return ['chinese.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), '中文'];
  const png = nativeImage
    .createFromBitmap(Buffer.from([0x10, 0x20, 0x40, 0xff]), { width: 1, height: 1 })
    .toPNG();
  return [
    'image.png',
    png,
    {
      'file-signature': 'image/png',
      'pixel-diff': '0 个不同像素',
      'image-compress': 'quality-',
      'favicon-kit': 'site-icons.zip',
    }[id],
  ];
}
module.exports = async (window, pane, id) => {
  const [name, bytes, expected] = await fixture(id),
    selector = pane + ' > [data-file-tool]';
  await window.webContents.executeJavaScript(
    '(' +
      ((selector, b64, name, id) => {
        const root = document.querySelector(selector),
          inputs = root.querySelectorAll('input[type=file]');
        const dt = new DataTransfer();
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], name, { type: name.endsWith('.png') ? 'image/png' : '' }));
        inputs[0].files = dt.files;
        inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
        if (id === 'pixel-diff') {
          const compare = new DataTransfer();
          compare.items.add(new File([bytes], 'second.png', { type: 'image/png' }));
          inputs[1].closest('label').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: compare }));
        }
      }).toString() +
      ')(' +
      [selector, Buffer.from(bytes).toString('base64'), name, id].map(JSON.stringify).join(',') +
      ')',
    true,
  );
  const js = (code) => window.webContents.executeJavaScript(code, true),
    root = 'document.querySelector(' + JSON.stringify(selector) + ')';
  if (id === 'pixel-diff') {
    const files = await js('[...' + root + '.querySelectorAll(".file-source .file-name")].map(el => el.title)');
    assert.deepEqual(files, [name, 'second.png']);
  }
  await js(root + ".querySelector('.file-run-actions .run-button').click()");
  for (let i = 0; i < 220; i++) {
    const text = await js(root + '.innerText');
    if (text.includes(expected)) {
      if (['favicon-kit', 'pixel-diff', 'image-compress'].includes(id)) {
        const data = await js(
          '(async()=>{const root=' +
            root +
            ';let blob,name;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{blob=b;return create.call(URL,b)};HTMLAnchorElement.prototype.click=function(){name=this.download};try{[...root.querySelectorAll("button")].find(b=>b.textContent==="下载结果").click();return {name,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}})()',
        );
        const bytes = Buffer.from(data.bytes);
        if (id === 'favicon-kit') {
          const archive = await require('jszip').loadAsync(bytes),
            icon = await archive.file('favicon.ico').async('nodebuffer');
          assert.equal(icon.readUInt16LE(2), 1);
          assert.equal(icon.readUInt16LE(4), 3);
          for (const [i, size] of [16, 32, 48].entries()) {
            assert.equal(icon[6 + i * 16], size);
            assert.equal(icon.readUInt32BE(icon.readUInt32LE(18 + i * 16)), 0x89504e47);
          }
          const manifest = JSON.parse(await archive.file('site.webmanifest').async('string'));
          for (const entry of manifest.icons) assert.ok(archive.file(entry.src));
        } else if (id === 'pixel-diff') assert.equal(bytes.readUInt32BE(0), 0x89504e47);
        else {
          assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
          assert.equal(data.name, 'quality-80.webp');
        }
      }
      return;
    }
    const error = await js(root + ".querySelector('[role=alert]')?.innerText");
    if (error) throw Error(id + ': ' + error);
    await new Promise((r) => setTimeout(r, 60));
  }
  assert.fail(id + ' 未得到预期产物 ' + expected);
};
