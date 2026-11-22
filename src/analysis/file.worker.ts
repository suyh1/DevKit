import { analyzeFile } from './file-analysis';
self.onmessage = async (e) => {
  try {
    const { id, file, options, right } = e.data;
    self.postMessage({ report: await analyzeFile(id, file, options, right) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
