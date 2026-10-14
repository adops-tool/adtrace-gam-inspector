export function safeDecode(value) {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readQueryParameter(query, name) {
  if (!Array.isArray(query)) return '';
  const found = query.find((parameter) => parameter?.name === name);
  return safeDecode(found?.value);
}

export function readHeader(headers, name) {
  if (!Array.isArray(headers)) return '';
  const found = headers.find(
    (header) => typeof header?.name === 'string' && header.name.toLowerCase() === name.toLowerCase()
  );
  return typeof found?.value === 'string' ? found.value : '';
}

export function getRequestQuery(entry) {
  let query = [];
  if (Array.isArray(entry?.request?.queryString) && entry.request.queryString.length) {
    query = entry.request.queryString;
  } else {
    try {
      query = [...new URL(entry.request.url).searchParams].map(([name, value]) => ({
        name,
        value: encodeURIComponent(value),
      }));
    } catch {}
  }
  const body = entry?.request?.postData;
  let bodyParams = [];
  if (
    typeof body?.mimeType === 'string' &&
    body.mimeType.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded' &&
    typeof body.text === 'string' &&
    body.text.length <= 262144
  ) {
    bodyParams = [...new URLSearchParams(body.text)].map(([name, value]) => ({
      name,
      value: encodeURIComponent(value),
    }));
  } else if (Array.isArray(body?.params)) {
    bodyParams = body.params
      .filter(
        (param) => typeof param?.name === 'string' && typeof param.value === 'string' && param.value.length <= 131072
      )
      .slice(0, 1000)
      .map(({ name, value }) => ({ name, value: encodeURIComponent(value) }));
  }
  return [...query, ...bodyParams];
}

export function parseJson(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, item]) =>
          !['__proto__', 'constructor', 'prototype'].includes(key) &&
          (typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))
      )
    );
  } catch {
    return {};
  }
}

export function debounce(callback, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSlotStatus(slot) {
  if (slot.isUnfill) return 'unfilled';
  return slot.lineitemId && slot.lineitemId !== '-1' ? 'filled' : 'unknown';
}

export function getPrivacyLabel(slot) {
  if (slot.isNPA) return 'Non-personalized';
  if (slot.gdpr === '1' && !slot.gdprConsent) return 'Consent missing';
  if (slot.gdpr === '1') return 'Consent present';
  if (slot.gdpr === '0') return 'GDPR not applicable';
  return 'Privacy unspecified';
}
