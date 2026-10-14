import { initDisplay, displayNavigation, displayAdsRequest, showNotice } from './display.js';
import { createCaptureController } from './capture.js';
import { removeSlotsOverlay, showSlotsOverlay } from './overlay.js';
import { settings, subscribeSettings } from './settings.js';

const api = globalThis.chrome;
const controller = createCaptureController({
  getOptions: () => settings,
  onRequest: displayAdsRequest,
  onNavigation: displayNavigation,
  onError: showNotice,
});

initDisplay({ onClear: controller.clear, onPause: controller.setPaused });

async function updateOverlay() {
  if (!api?.devtools?.inspectedWindow) return;
  if (!api.scripting) {
    if (settings.showOverlay) showNotice('Enable slot overlays and grant site access in Settings.');
    return;
  }
  try {
    const results = await api.scripting.executeScript({
      func: settings.showOverlay ? showSlotsOverlay : removeSlotsOverlay,
      target: { tabId: api.devtools.inspectedWindow.tabId },
      world: 'MAIN',
    });
    if (settings.showOverlay && results[0]?.result === 'unavailable') {
      showNotice('Google Publisher Tag is not available yet. Overlays will appear when slots render.');
    }
  } catch {
    if (settings.showOverlay)
      showNotice('Slot overlays need site access. Enable them in Settings and reload the inspected page.');
  }
}

if (api?.devtools?.network) {
  api.devtools.network.onRequestFinished.addListener(controller.accept);
  api.devtools.network.onNavigated.addListener((url) => {
    controller.navigate(url);
    void updateOverlay();
  });
  const initialNavigation = controller.navigation;
  const initialGeneration = controller.generation;
  api.devtools.network.getHAR((har) => {
    if (controller.navigation !== initialNavigation || controller.generation !== initialGeneration) return;
    for (const entry of har?.entries || []) void controller.accept(entry);
  });
  void updateOverlay();
  const overlayHeartbeat = setInterval(() => {
    if (settings.showOverlay) void updateOverlay();
  }, 10000);
  let previousOverlay = settings.showOverlay;
  subscribeSettings(() => {
    if (previousOverlay === settings.showOverlay) return;
    previousOverlay = settings.showOverlay;
    void updateOverlay();
  });
  window.addEventListener('pagehide', () => {
    clearInterval(overlayHeartbeat);
    api.devtools.network.onRequestFinished.removeListener(controller.accept);
    if (settings.showOverlay && api.scripting) {
      void api.scripting
        .executeScript({
          func: removeSlotsOverlay,
          target: { tabId: api.devtools.inspectedWindow.tabId },
          world: 'MAIN',
        })
        .catch(() => {});
    }
  });
} else {
  document.getElementById('connection-label').textContent = 'Preview mode';
  document.getElementById('connection-status').classList.add('preview');
  if (new URLSearchParams(location.search).get('demo') === '1') {
    const { loadDemo } = await import('../../tests/test.js');
    await loadDemo(controller);
  }
}
