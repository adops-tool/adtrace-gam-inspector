import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCaptureController } from '../assets/js/capture.js';
import { defaults, settings } from '../assets/js/settings.js';

const fixture = async () => JSON.parse(await readFile(new URL('request.json', import.meta.url), 'utf8'));

function setup(options = {}) {
  const received = [];
  const navigations = [];
  const errors = [];
  const controller = createCaptureController({
    getOptions: () => ({ ...defaults, ...options }),
    onRequest: (slots, metadata) => received.push({ slots, ...metadata }),
    onNavigation: (url) => navigations.push(url),
    onError: (error) => errors.push(error),
  });
  return { controller, received, navigations, errors };
}

test('capture deduplicates initial HAR and live events; pause and clear work', async () => {
  const entry = await fixture();
  const { controller, received } = setup();
  await controller.accept(entry);
  await controller.accept(structuredClone(entry));
  assert.equal(received.length, 1);
  controller.clear();
  controller.setPaused(true);
  await controller.accept(entry);
  assert.equal(received.length, 1);
  controller.setPaused(false);
  await controller.accept(entry);
  assert.equal(received.length, 2);
});

test('navigation discards responses still parsing for the previous page', async () => {
  const entry = await fixture();
  const { controller, received, navigations } = setup();
  settings.captureAdditionalInformation = true;
  let finish;
  try {
    entry.getContent = (callback) => {
      finish = callback;
    };
    const pending = controller.accept(entry);
    controller.navigate('https://next.example');
    finish('');
    await pending;
    assert.equal(received.length, 0);
    assert.deepEqual(navigations, ['https://next.example']);
  } finally {
    settings.captureAdditionalInformation = false;
  }
});

test('preserve log retains in-flight requests across navigation, clear discards them', async () => {
  const entry = await fixture();
  const { controller, received } = setup({ preserveLog: true });
  settings.captureAdditionalInformation = true;
  let finish;
  try {
    entry.getContent = (callback) => {
      finish = callback;
    };
    const first = controller.accept(entry);
    controller.navigate('https://next.example');
    finish('');
    await first;
    assert.equal(received.length, 1);
    controller.clear();
    const second = controller.accept(entry);
    controller.clear();
    finish('');
    await second;
    assert.equal(received.length, 1);
  } finally {
    settings.captureAdditionalInformation = false;
  }
});

test('initial HAR bursts are queued instead of silently losing requests', async () => {
  const entry = await fixture();
  const { controller, received, errors } = setup();
  await Promise.all(
    Array.from({ length: 80 }, (_, index) =>
      controller.accept({
        ...entry,
        startedDateTime: new Date(1700000000000 + index).toISOString(),
      })
    )
  );
  assert.equal(received.length, 80);
  assert.equal(errors.length, 0);
  assert.equal(new Set(received.map((record) => record.id)).size, 80);
});

test('malformed and unrelated requests do not interrupt capture', async () => {
  const { controller, received } = setup();
  await controller.accept(null);
  await controller.accept({});
  await controller.accept({ request: { url: 'invalid' } });
  await controller.accept(await fixture());
  assert.equal(received.length, 1);
});

test('POST requests with different payloads are captured separately at the same timestamp', async () => {
  const { controller, received } = setup();
  const entry = {
    startedDateTime: '2026-01-01T00:00:00.000Z',
    request: {
      method: 'POST',
      url: 'https://securepubads.g.doubleclick.net/gampad/ads',
      postData: { mimeType: 'application/x-www-form-urlencoded', text: 'iu=%2F123%2Ffirst' },
    },
  };
  await controller.accept(entry);
  await controller.accept(structuredClone(entry));
  entry.request.postData.text = 'iu=%2F123%2Fsecond';
  await controller.accept(entry);
  assert.equal(received.length, 2);
  assert.equal(received[0].slots[0].adUnit, '/123/first');
  assert.equal(received[1].slots[0].adUnit, '/123/second');
});
