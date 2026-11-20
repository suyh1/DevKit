import { pipeline } from 'node:stream/promises';

export async function downloadTransfer(manager, input, access, response, signal) {
  const { file, name, size } = await manager.openTransfer(input, access);
  try {
    access.authorize();
    const encoded = encodeURIComponent(name.toWellFormed()).replace(
      /[!'()*]/g,
      (char) => '%' + char.charCodeAt(0).toString(16),
    );
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
    });
    await pipeline(file.createReadStream(), response, { signal });
  } finally {
    await file.close();
  }
}
