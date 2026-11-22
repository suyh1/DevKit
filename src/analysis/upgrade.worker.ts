import { upgrade } from './upgrades';
self.onmessage = async (e) => {
  try {
    const { id, input, options } = e.data;
    self.postMessage({ output: await upgrade(id, input, options) });
  } catch (err) {
    self.postMessage({ error: (err as Error).message });
  }
};
