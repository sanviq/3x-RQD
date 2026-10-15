export class ApiError extends Error {
  constructor(message: string, public status?: number) { super(message); this.name = 'ApiError'; }
}
export const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
export async function request(path: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(apiBaseUrl + path, { ...init, signal: controller.signal });
    let data: unknown;
    try { data = await response.json(); } catch {
      if (response.ok) throw new ApiError('The service returned an unreadable response. Please try again.', response.status);
    }
    if (!response.ok) {
      let message = response.status === 413 ? 'This image exceeds the 12 MiB upload limit.'
        : response.status >= 500 ? 'The analysis service encountered an error. Please try again.'
        : 'The service could not accept this request.';
      if (response.status < 500 && record(data)) {
        if (typeof data.detail === 'string' && !/<[a-z][\s\S]*>/i.test(data.detail)) message = data.detail.slice(0, 500);
        if (Array.isArray(data.detail)) {
          const messages = data.detail.filter(record).map(item => {
            const location = Array.isArray(item.loc) ? item.loc.filter(x => x !== 'body').join(' · ') : 'Input';
            return location + ': ' + (typeof item.msg === 'string' ? item.msg.slice(0, 200) : 'Invalid value');
          });
          if (messages.length) message = messages.join('; ');
        }
      }
      throw new ApiError(message, response.status);
    }
    return data;
  } catch (error) {
    if (timedOut) throw new ApiError('The analysis service took too long to respond. Your inputs are preserved; try again.');
    if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (error instanceof ApiError) throw error;
    throw new ApiError('The analysis service could not be reached. Check that FastAPI is running, then retry.');
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}
export const isRecord = record;
export const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
