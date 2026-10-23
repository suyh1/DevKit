import { transform } from './tools';
import type { ToolId, Options } from './tools';

self.onmessage = async (event: MessageEvent<{ id: ToolId; input: string; options: Options }>) => {
  try {
    const output = await transform(event.data.id, event.data.input, event.data.options);
    if (output.length > 4_000_000) throw new Error('结果超过 4,000,000 字符，请缩小输入或生成数量。');
    self.postMessage({ output });
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '处理失败，请检查输入。' }); }
};
