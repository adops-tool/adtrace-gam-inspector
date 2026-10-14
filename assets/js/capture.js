import { analyzeAdsRequest, analyzeBasicAdRequest, isAdsRequest, isBasicAdRequest } from './analyze.js';
import { getRequestQuery } from './utils.js';

export function createCaptureController({ getOptions, onRequest, onNavigation, onError = () => {} }) {
  let generation = 0;
  let navigation = 0;
  let sequence = 0;
  let active = 0;
  let paused = false;
  const seen = new Set();
  const queue = [];

  function clear() {
    generation++;
    seen.clear();
    for (const item of queue.splice(0)) item.resolve();
  }

  function accept(entry) {
    if (paused || !entry?.request || entry.request.url?.length > 131072) return;
    const multiple = isAdsRequest(entry);
    if (!multiple && !isBasicAdRequest(entry)) return;
    if (entry.response?.status === 400 && entry.response?.statusText === 'Service Worker Fallback Required') return;
    const bodyKey =
      entry.request.method === 'POST'
        ? JSON.stringify(
            getRequestQuery(entry).map((parameter) => [
              typeof parameter?.name === 'string' ? parameter.name : '',
              typeof parameter?.value === 'string' ? parameter.value : '',
            ])
          )
        : '';
    const key = `${entry.startedDateTime || ''}|${entry.request.method || ''}|${entry.request.url}|${bodyKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > getOptions().maxRequests * 2) seen.delete(seen.values().next().value);
    return new Promise((resolve) => {
      queue.push({ entry, multiple, token: generation, id: ++sequence, resolve });
      if (queue.length > getOptions().maxRequests) {
        queue.shift().resolve();
        onError(
          'Older queued requests were skipped to keep capture responsive. Disable additional response details for high-volume pages.'
        );
      }
      drain();
    });
  }

  function drain() {
    while (active < 4 && queue.length) void process(queue.shift());
  }

  async function process({ entry, multiple, token, id, resolve }) {
    active++;
    try {
      const slots = await (multiple ? analyzeAdsRequest(entry) : [analyzeBasicAdRequest(entry)]);
      if (token !== generation || !slots.length) return;
      const timestamp = Date.parse(entry.startedDateTime);
      onRequest(slots, {
        id,
        startedDateTime: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
        duration: Number.isFinite(entry.time) && entry.time >= 0 ? entry.time : null,
        httpStatus: Number(entry.response?.status) || 0,
      });
    } catch {
      if (token === generation) onError('A request could not be analyzed. Capture is still running.');
    } finally {
      active--;
      resolve();
      drain();
    }
  }

  return {
    accept,
    clear,
    setPaused(value) {
      paused = Boolean(value);
    },
    get generation() {
      return generation;
    },
    get navigation() {
      return navigation;
    },
    navigate(url) {
      navigation++;
      if (!getOptions().preserveLog) clear();
      onNavigation(url);
    },
  };
}
