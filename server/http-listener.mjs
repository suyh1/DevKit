export function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const failed = (error) => {
      server.off('listening', ready);
      reject(
        new Error(
          error.code === 'EADDRINUSE'
            ? `端口 ${port} 已被占用。`
            : `无法监听端口 ${port}（${error.code || '未知错误'}）。`,
        ),
      );
    };
    const ready = () => {
      server.off('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, host);
  });
}
export function closeListener(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
