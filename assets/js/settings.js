import { parseJson } from './utils.js';

export const defaults = Object.freeze({
  networkId: '',
  showOverlay: false,
  featuredTargetings: 'hb_bidder,hb_pb,amznbid',
  preserveLog: false,
  captureAdditionalInformation: false,
  advertisersJson: '{}',
  amazonBidsJson: '{}',
  amazonBiddersJson: '{}',
  hideGdprConsent: true,
  hidePpid: true,
  hideGlobalTargetings: false,
  hideSlotsTargetings: false,
  hideSlotsSizes: false,
  hideVideo: false,
  maxRequests: 250,
  theme: 'light',
});

export function normalizeOptions(input = {}) {
  const result = { ...defaults };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof input[key] === typeof fallback) result[key] = input[key];
  }
  result.networkId = /^\d+$/.test(result.networkId.trim()) ? result.networkId.trim() : '';
  result.featuredTargetings = [
    ...new Set(
      result.featuredTargetings
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean)
    ),
  ]
    .slice(0, 100)
    .join(',');
  result.maxRequests = Math.min(2000, Math.max(50, Math.trunc(result.maxRequests) || defaults.maxRequests));
  result.theme = ['light', 'dark', 'system'].includes(result.theme) ? result.theme : defaults.theme;
  for (const key of ['advertisersJson', 'amazonBidsJson', 'amazonBiddersJson']) {
    result[key] = JSON.stringify(parseJson(result[key]));
  }
  return result;
}

export const settings = { ...defaults };
const listeners = new Set();
const storage = globalThis.chrome?.storage;

if (storage?.local) {
  try {
    Object.assign(settings, normalizeOptions(await storage.local.get(Object.keys(defaults))));
  } catch {
    console.warn('GAM settings could not be loaded. Default settings are active.');
  }
  storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Object.keys(defaults).some((key) => Object.hasOwn(changes, key))) return;
    const next = { ...settings };
    for (const key of Object.keys(defaults)) {
      if (Object.hasOwn(changes, key)) next[key] = changes[key].newValue ?? defaults[key];
    }
    updateSettings(normalizeOptions(next));
  });
}

export function subscribeSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function saveSettings(values) {
  const next = normalizeOptions({ ...settings, ...values });
  if (storage?.local) await storage.local.set(next);
  updateSettings(next);
}

function updateSettings(next) {
  if (!Object.keys(defaults).some((key) => settings[key] !== next[key])) return;
  Object.assign(settings, next);
  for (const listener of listeners) listener(settings);
}

export function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
}
