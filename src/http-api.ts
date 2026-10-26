import type { HttpInput, HttpResponse } from './http-model';
declare global { interface Window { devkitHttp?: { request: (action: 'send' | 'cancel' | 'get-library' | 'save-library' | 'restore-library', payload?: unknown) => Promise<{ data?: unknown; error?: string }> } } }
export async function sendHttp(id: string, request: HttpInput): Promise<HttpResponse> {
  if (!window.devkitHttp) throw new Error('真实 HTTP 调试需要 DevKit 桌面端。');
  const result = await window.devkitHttp.request('send', { id, request });
  if (result.error) throw new Error(result.error);
  return result.data as HttpResponse;
}
export async function cancelHttp(id: string) {
  const result = await window.devkitHttp?.request('cancel', { id });
  if (result?.error) throw new Error(result.error);
}
