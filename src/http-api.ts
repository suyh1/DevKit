import type { HttpInput, HttpResponse } from './http-model';
import { remoteRequest } from './workspace-remote';
declare global { interface Window { devkitHttp?: { request: (action: 'send' | 'cancel' | 'get-library' | 'save-library' | 'restore-library', payload?: unknown) => Promise<{ data?: unknown; error?: string }> } } }
export async function sendHttp(id: string, request: HttpInput): Promise<HttpResponse> {
  if (!window.devkitHttp) return remoteRequest<HttpResponse>('http', 'send', { id, request });
  const result = await window.devkitHttp.request('send', { id, request });
  if (result.error) throw new Error(result.error);
  return result.data as HttpResponse;
}
export async function cancelHttp(id: string) {
  if (!window.devkitHttp) return remoteRequest('http', 'cancel', { id });
  const result = await window.devkitHttp?.request('cancel', { id });
  if (result?.error) throw new Error(result.error);
}
