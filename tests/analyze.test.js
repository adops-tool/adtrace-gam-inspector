import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  analyzeAdsRequest,
  analyzeBasicAdRequest,
  CONTENT_TIMEOUT,
  isAdsRequest,
  isBasicAdRequest,
  isGoogleAdsRequest,
  MAX_CONTENT_LENGTH,
  parseResponseContent,
} from '../assets/js/analyze.js';
import { defaults, normalizeOptions, settings } from '../assets/js/settings.js';
import { getPrivacyLabel, getSlotStatus, parseJson, readHeader, readQueryParameter } from '../assets/js/utils.js';
import { serializeRequests } from '../assets/js/export.js';

const fixture = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));

test('all existing request fixtures remain supported', async () => {
  for (const name of ['request.json', 'request-anonymous.json', 'request-unfill.json']) {
    const entry = await fixture(name);
    assert.equal(isAdsRequest(entry), true);
    const slots = await analyzeAdsRequest(entry);
    assert.equal(slots.length, 2);
    assert.equal(
      slots[0].adUnit,
      name === 'request-anonymous.json' ? '/ID/site/home/portada/x01' : '/ID/site/home/portada/Left1'
    );
    assert.equal(
      slots[1].adUnit,
      name === 'request-anonymous.json' ? '/ID/site/home/portada/Top' : '/ID/site/home/portada/Right1'
    );
  }
  for (const name of ['request-basic.json', 'request-basic-unfill.json']) {
    const entry = await fixture(name);
    assert.equal(isBasicAdRequest(entry), true);
    assert.equal(analyzeBasicAdRequest(entry).adUnit, '/ID/site/home/portada/Sticky');
  }
});

test('request recognition rejects unrelated endpoints and lookalike domains', () => {
  for (const url of [
    'https://doubleclick.net.attacker.example/gampad/ads?iu=123',
    'https://attacker.example/ads?iu=123',
    'https://securepubads.g.doubleclick.net/other/ads?iu=123',
    'javascript:ads?iu=123',
    'invalid',
  ])
    assert.equal(isGoogleAdsRequest({ request: { url } }), false);
  assert.equal(isGoogleAdsRequest(null), false);
});

test('missing fields and malformed percent escapes do not stop analysis', async () => {
  assert.equal(readQueryParameter([{ name: 'iu', value: '50%off' }], 'iu'), '50%off');
  assert.equal(readQueryParameter(null, 'iu'), '');
  assert.equal(readHeader(null, 'google-creative-id'), '');
  assert.equal(readHeader([{ name: 'Google-Creative-ID', value: '42' }], 'google-creative-id'), '42');
  const entry = await fixture('request.json');
  entry.request.queryString = entry.request.queryString.filter(({ name }) =>
    ['iu_parts', 'enc_prev_ius'].includes(name)
  );
  entry.response = {};
  const slots = await analyzeAdsRequest(entry);
  assert.equal(slots[0].sizes, '');
  assert.equal(slots[0].slotTargetings, '');
  entry.request.queryString.find(({ name }) => name === 'enc_prev_ius').value = '/999';
  assert.deepEqual(await analyzeAdsRequest(entry), []);
});

test('URL fallback decodes each query layer exactly once', () => {
  const slot = analyzeBasicAdRequest({
    request: { url: 'https://securepubads.g.doubleclick.net/gampad/ads?iu=%2F123%2F50%2525&scp=offer%3D50%2525' },
  });
  assert.equal(slot.adUnit, '/123/50%25');
  assert.equal(new URLSearchParams(slot.slotTargetings).get('offer'), '50%');
});

test('form-encoded POST requests include body targeting parameters', () => {
  const entry = {
    request: {
      url: 'https://securepubads.g.doubleclick.net/gampad/ads?gdfp_req=1',
      method: 'POST',
      postData: {
        mimeType: 'application/x-www-form-urlencoded; charset=UTF-8',
        text: 'iu=%2F123%2Fpost-slot&sz=300x250&scp=offer%3D50%2525',
      },
    },
  };
  assert.equal(isBasicAdRequest(entry), true);
  const slot = analyzeBasicAdRequest(entry);
  assert.equal(slot.adUnit, '/123/post-slot');
  assert.equal(new URLSearchParams(slot.slotTargetings).get('offer'), '50%');
});

test('privacy and delivery labels distinguish absent data from explicit signals', () => {
  const entry = { request: { queryString: [] } };
  let slot = analyzeBasicAdRequest(entry);
  assert.equal(slot.isAnonymous, false);
  assert.equal(getPrivacyLabel(slot), 'Privacy unspecified');
  assert.equal(getSlotStatus(slot), 'unknown');
  entry.request.queryString.push({ name: 'gdpr', value: '1' });
  slot = analyzeBasicAdRequest(entry);
  assert.equal(slot.isAnonymous, true);
  assert.equal(getPrivacyLabel(slot), 'Consent missing');
  assert.equal(getSlotStatus({ lineitemId: '-1' }), 'unknown');
  assert.equal(getSlotStatus({ lineitemId: '-2', isUnfill: true }), 'unfilled');
  assert.equal(getSlotStatus({ lineitemId: '123' }), 'filled');
});

test('response details handle base64, invalid JSON and preserve slot positions', () => {
  const value = Array(18).fill(null);
  value[5] = 250;
  value[6] = 300;
  value[16] = ['42'];
  value[17] = ['84'];
  const json = JSON.stringify({ slot: value });
  const winner = { advertiserId: '42', orderId: '84', size: { width: 300, height: 250 } };
  assert.deepEqual(parseResponseContent(json), [winner]);
  assert.deepEqual(parseResponseContent(Buffer.from(json).toString('base64'), 'base64'), [winner]);
  assert.deepEqual(parseResponseContent('{broken}\n' + json), [{}, winner]);
  assert.deepEqual(parseResponseContent('{}\n' + json), [{}, winner]);
  assert.deepEqual(parseResponseContent('x'.repeat(MAX_CONTENT_LENGTH + 1)), []);
  assert.deepEqual(parseResponseContent('not-base64!', 'base64'), []);
});

test('optional content retrieval recovers from callback failure and timeout', async () => {
  const entry = await fixture('request.json');
  settings.captureAdditionalInformation = true;
  try {
    entry.getContent = () => {
      throw new Error('Content unavailable');
    };
    assert.equal((await analyzeAdsRequest(entry)).length, 2);
    entry.getContent = (callback) => callback('{broken}');
    assert.equal((await analyzeAdsRequest(entry)).length, 2);
    entry.getContent = () => {};
    const started = Date.now();
    assert.equal((await analyzeAdsRequest(entry)).length, 2);
    assert.ok(Date.now() - started >= CONTENT_TIMEOUT - 25);
    assert.ok(Date.now() - started < CONTENT_TIMEOUT + 2000);
  } finally {
    settings.captureAdditionalInformation = false;
  }
});

test('settings normalize types and maps without exposing prototype keys', () => {
  assert.deepEqual(parseJson('[1,2]'), {});
  assert.deepEqual(parseJson('{"__proto__":"x","zero":0,"nested":{"a":1}}'), { zero: 0 });
  const normalized = normalizeOptions({
    networkId: '123/evil',
    maxRequests: Infinity,
    theme: 'unsafe',
    hidePpid: 'false',
  });
  assert.equal(normalized.networkId, '');
  assert.equal(normalized.maxRequests, 2000);
  assert.equal(normalized.theme, 'light');
  assert.equal(normalized.hidePpid, true);
  assert.equal(normalizeOptions({ maxRequests: NaN }).maxRequests, defaults.maxRequests);
});

test('exports omit hidden identifiers and raw HAR URLs or cookies', () => {
  const records = [
    {
      id: 1,
      startedDateTime: '2026-01-01T00:00:00.000Z',
      duration: 42,
      httpStatus: 200,
      url: 'https://example.com/?secret=1',
      cookies: ['secret'],
      slots: [{ adUnit: '/123/test', gdprConsent: 'private-consent', ppid: 'private-id' }],
    },
  ];
  const output = serializeRequests(records, defaults);
  const text = JSON.stringify(output);
  assert.equal(text.includes('private-consent'), false);
  assert.equal(text.includes('private-id'), false);
  assert.equal(text.includes('secret'), false);
  assert.equal(records[0].slots[0].ppid, 'private-id');
  assert.equal(
    serializeRequests(records, { hideGdprConsent: false, hidePpid: false }).requests[0].slots[0].ppid,
    'private-id'
  );
});
