const { PassThrough } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { dialog } = require('electron');

// The renderer can write only to the destination explicitly chosen in this window.
module.exports = function directSave(window) {
  const sinks = new Map();
  function cancel(key) {
    const sink = sinks.get(key);
    if (!sink) return;
    sinks.delete(key);
    clearTimeout(sink.timer);
    sink.stream.destroy(new Error('直传保存已中止。'));
  }
  function reset(key, sink) {
    clearTimeout(sink.timer);
    sink.timer = setTimeout(() => cancel(key), 120000);
  }
  window.webContents.on('render-process-gone', () => {
    for (const key of sinks.keys()) cancel(key);
  });
  window.on('closed', () => {
    for (const key of sinks.keys()) cancel(key);
  });
  return async (action, input) => {
    if (action === 'directsave') {
      if (sinks.size >= 4 || !Number.isSafeInteger(input.size) || input.size < 0) throw new Error('无法开始接收。');
      const name = String(input.name || 'download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
      const result = await dialog.showSaveDialog(window, {
        title: '保存直传文件',
        defaultPath: ['.', '..'].includes(name) ? 'download' : name,
      });
      if (result.canceled || !result.filePath) return null;
      const { atomicFile } = await import('./server/atomic-file.mjs');
      const key = randomUUID(),
        stream = new PassThrough();
      const sink = { stream, remaining: input.size };
      stream.on('error', (error) => {
        sink.error = error;
      });
      sinks.set(key, sink);
      reset(key, sink);
      sink.saved = atomicFile(result.filePath, stream);
      sink.saved.catch((error) => {
        sink.error = error;
        stream.destroy();
      });
      return key;
    }
    const sink = sinks.get(input.key);
    if (!sink) throw new Error('直传保存已结束。');
    if (action === 'directabort') {
      cancel(input.key);
      return;
    }
    if (sink.error) throw sink.error;
    reset(input.key, sink);
    if (action === 'directwrite') {
      if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 524288 || input.bytes.length > sink.remaining)
        throw new Error('直传数据大小无效。');
      sink.remaining -= input.bytes.length;
      await new Promise((resolve, reject) => {
        const closed = () => reject(sink.error || new Error('直传保存已中止。'));
        sink.stream.once('close', closed);
        sink.stream.write(input.bytes, (error) => {
          sink.stream.off('close', closed);
          if (error) reject(error);
          else resolve();
        });
      });
      return;
    }
    if (action !== 'directfinish' || sink.remaining) throw new Error('直传文件尚未完整接收。');
    try {
      sink.stream.end();
      await sink.saved;
    } finally {
      clearTimeout(sink.timer);
      sinks.delete(input.key);
    }
  };
};
