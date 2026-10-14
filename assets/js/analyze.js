import { getRequestQuery, parseJson, readHeader, readQueryParameter } from './utils.js';
import { settings } from './settings.js';

export const CONTENT_TIMEOUT = 1500;
export const MAX_CONTENT_LENGTH = 2 * 1024 * 1024;

export function isGoogleAdsRequest(entry) {
  try {
    const url = new URL(entry.request.url);
    const host = url.hostname.toLowerCase();
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      (host === 'doubleclick.net' ||
        host.endsWith('.doubleclick.net') ||
        host === 'googlesyndication.com' ||
        host.endsWith('.googlesyndication.com')) &&
      /^\/(?:gampad|pagead)\/ads\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isAdsRequest(entry) {
  return isGoogleAdsRequest(entry) && Boolean(readQueryParameter(getRequestQuery(entry), 'iu_parts'));
}

export function isBasicAdRequest(entry) {
  return isGoogleAdsRequest(entry) && Boolean(readQueryParameter(getRequestQuery(entry), 'iu'));
}

function commonFields(entry, query) {
  const isNPA = readQueryParameter(query, 'npa') === '1';
  const gdpr = readQueryParameter(query, 'gdpr');
  const gdprConsent = readQueryParameter(query, 'gdpr_consent');
  return {
    globalTargetings: readQueryParameter(query, 'cust_params'),
    isNPA,
    isAnonymous: isNPA || (gdpr === '1' && !gdprConsent),
    ppid: readQueryParameter(query, 'ppid'),
    gdpr,
    gdprConsent,
    httpStatus: Number(entry.response?.status) || 0,
  };
}

export async function analyzeAdsRequest(entry) {
  const query = getRequestQuery(entry);
  const parts = readQueryParameter(query, 'iu_parts').split(',');
  const codes = readQueryParameter(query, 'enc_prev_ius');
  if (!codes) return [];
  const units = codes.split(',').slice(0, 200);
  const sizes = readQueryParameter(query, 'prev_iu_szs').split(',');
  const targetings = readQueryParameter(query, 'prev_scp').split('|');
  const creatives = readHeader(entry.response?.headers, 'google-creative-id').split(',');
  const lineitems = readHeader(entry.response?.headers, 'google-lineitem-id').split(',');
  const common = commonFields(entry, query);
  const winners = await parseContentResponse(entry);
  const advertisers = parseJson(settings.advertisersJson);

  return units.flatMap((code, index) => {
    const indices = code.split('/').filter(Boolean);
    if (!indices.length || indices.some((id) => !/^\d+$/.test(id) || !parts[Number(id)])) return [];
    const winner = winners[index] || {};
    const advertiserWinner = Object.hasOwn(advertisers, winner.advertiserId) ? advertisers[winner.advertiserId] : '';
    return [
      {
        ...common,
        adUnit: '/' + indices.map((id) => parts[Number(id)]).join('/'),
        sizes: sizes[index] || '',
        slotTargetings: targetings[index] || '',
        creativeId: creatives[index] || '',
        lineitemId: lineitems[index] || '',
        orderId: winner.orderId || '',
        advertiserId: winner.advertiserId || '',
        advertiserWinner,
        sizeWinner: winner.size || null,
        isUnfill: lineitems[index] === '-2',
        video: null,
      },
    ];
  });
}

export function analyzeBasicAdRequest(entry) {
  const query = getRequestQuery(entry);
  const lineitemId = readHeader(entry.response?.headers, 'google-lineitem-id');
  const video = Object.fromEntries(
    ['env', 'output', 'plcmt', 'vpa', 'vpmute', 'vpos']
      .map((key) => [key, readQueryParameter(query, key)])
      .filter(([, value]) => value)
  );
  return {
    ...commonFields(entry, query),
    adUnit: readQueryParameter(query, 'iu'),
    sizes: readQueryParameter(query, 'sz'),
    slotTargetings: readQueryParameter(query, 'scp'),
    creativeId: readHeader(entry.response?.headers, 'google-creative-id'),
    lineitemId,
    orderId: '',
    advertiserId: '',
    advertiserWinner: '',
    sizeWinner: null,
    isUnfill: lineitemId === '-2',
    video: Object.keys(video).length ? video : null,
  };
}

export function parseResponseContent(content, encoding = '') {
  if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) return [];
  try {
    if (encoding === 'base64') content = atob(content);
    return content
      .split('\n')
      .flatMap((line) => {
        line = line.trim();
        if (!line.startsWith('{')) return [];
        try {
          const raw = JSON.parse(line);
          if (!raw || typeof raw !== 'object') return [{}];
          const value = Object.values(raw).find(Array.isArray);
          if (!value) return [{}];
          const width = Number(value[6]);
          const height = Number(value[5]);
          const scalarId = (id) =>
            typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)) ? String(id) : '';
          return [
            {
              advertiserId: scalarId(Array.isArray(value[16]) ? value[16][0] : ''),
              orderId: scalarId(Array.isArray(value[17]) ? value[17][0] : ''),
              size:
                Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null,
            },
          ];
        } catch {
          return [{}];
        }
      })
      .slice(0, 200);
  } catch {
    return [];
  }
}

async function parseContentResponse(entry) {
  if (!settings.captureAdditionalInformation || typeof entry.getContent !== 'function') return [];
  return new Promise((resolve) => {
    let settled = false;
    const finish = (data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(data);
    };
    const timeout = setTimeout(() => finish([]), CONTENT_TIMEOUT);
    try {
      entry.getContent((content, encoding) => {
        if (settled) return;
        finish(parseResponseContent(content, encoding));
      });
    } catch {
      finish([]);
    }
  });
}
