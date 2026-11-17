import { StringDecoder } from 'node:string_decoder';

export function readJsonLines(stream, receive, fail) {
  const decoder = new StringDecoder('utf8');
  let buffered = '';
  stream.on('data', chunk => {
    buffered += decoder.write(chunk);
    try {
      if (buffered.length > 48_000_000) throw new Error('远程管理消息超过大小限制。');
      let end;
      while ((end = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 1);
        if (line.trim()) receive(JSON.parse(line));
      }
    } catch (error) { buffered = ''; fail(error); }
  });
}
