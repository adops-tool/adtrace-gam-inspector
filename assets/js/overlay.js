// Injected functions must be self-contained because they run in the inspected page.
export function showSlotsOverlay() {
  const key = '__gamInspectorOverlayV1';
  if (window[key]?.active) {
    window[key].renewedAt = Date.now();
    return 'active';
  }

  const state = { active: true, renewedAt: Date.now(), labels: new Map(), frame: 0, service: null };
  window[key] = state;
  const host = document.createElement('div');
  host.setAttribute('data-gam-inspector', 'overlays');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent =
    '.label{position:absolute;box-sizing:border-box;padding:6px 9px;border:1px solid #72b78b;border-radius:5px;background:#e5f5ebf2;color:#184b30;font:600 11px/1.5 system-ui,sans-serif;overflow-wrap:anywhere;box-shadow:0 2px 8px #0002}.size{display:block;font-weight:400;opacity:.75}';
  shadow.append(style);

  const positionLabels = () => {
    state.frame = 0;
    for (const [id, value] of state.labels) {
      const root = document.getElementById(id);
      if (!root?.isConnected) {
        value.label.remove();
        state.labels.delete(id);
        continue;
      }
      const target = root.querySelector('iframe[id^="google_ads_iframe_"]') || root;
      const rect = target.getBoundingClientRect();
      value.label.hidden = rect.width === 0 || rect.height === 0;
      value.label.style.transform = `translate(${Math.round(rect.left)}px,${Math.round(rect.top)}px)`;
      value.label.style.width = `${Math.max(60, Math.round(rect.width))}px`;
      value.size.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    }
  };
  const schedulePosition = () => {
    if (!state.frame) state.frame = requestAnimationFrame(positionLabels);
  };
  const addSlot = (slot, empty = false) => {
    if (!state.active) return;
    const id = slot.getSlotElementId();
    if (typeof id !== 'string') return;
    if (empty) {
      state.labels.get(id)?.label.remove();
      state.labels.delete(id);
      return;
    }
    if (!document.getElementById(id)) return;
    if (!state.labels.has(id) && state.labels.size < 200) {
      const label = document.createElement('div');
      label.className = 'label';
      const name = document.createElement('span');
      name.textContent = id;
      const size = document.createElement('span');
      size.className = 'size';
      label.append(name, size);
      shadow.append(label);
      state.labels.set(id, { label, size });
    }
    schedulePosition();
  };
  const onRendered = (event) => addSlot(event.slot, event.isEmpty);
  state.cleanup = () => {
    if (!state.active) return;
    state.active = false;
    state.service?.removeEventListener('slotRenderEnded', onRendered);
    window.removeEventListener('scroll', schedulePosition, true);
    window.removeEventListener('resize', schedulePosition);
    window.removeEventListener('pagehide', state.cleanup);
    clearInterval(state.timer);
    cancelAnimationFrame(state.frame);
    host.remove();
    state.labels.clear();
    if (window[key] === state) delete window[key];
  };
  // A lease also removes overlays when DevTools closes without a pagehide event.
  state.timer = setInterval(() => {
    if (Date.now() - state.renewedAt > 30000) state.cleanup();
    else if (state.service) schedulePosition();
  }, 2000);
  window.addEventListener('pagehide', state.cleanup, { once: true });
  window.googletag = window.googletag || { cmd: [] };
  window.googletag.cmd = window.googletag.cmd || [];
  window.googletag.cmd.push(() => {
    if (!state.active || !window.googletag.apiReady) return;
    try {
      state.service = window.googletag.pubads();
      (document.body || document.documentElement).append(host);
      for (const slot of state.service.getSlots()) {
        if (slot.getResponseInformation()) addSlot(slot);
      }
      state.service.addEventListener('slotRenderEnded', onRendered);
      window.addEventListener('scroll', schedulePosition, { passive: true, capture: true });
      window.addEventListener('resize', schedulePosition, { passive: true });
    } catch {
      state.cleanup();
    }
  });
  return window.googletag.apiReady ? 'active' : 'unavailable';
}

export function removeSlotsOverlay() {
  window.__gamInspectorOverlayV1?.cleanup();
}
