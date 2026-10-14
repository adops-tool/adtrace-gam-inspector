import { debounce, getPrivacyLabel, getSlotStatus, parseJson } from './utils.js';
import { applyTheme, saveSettings, settings, subscribeSettings } from './settings.js';
import { element, hydrateIcons, icon } from './ui.js';
import { serializeRequests } from './export.js';

const records = [];
const searchIndexes = new WeakMap();
let nextId = 0;
let filter = 'all';
let query = '';
let paused = false;
let initialized = false;
let renderFrame = 0;
let noticeTimer;
let hooks = {};
let content;
let featured = new Set();
let amazonBids = {};
let amazonBidders = {};

function badge(text, type = '') {
  return element('span', `badge ${type}`, text);
}

function actionButton(name, label, className = 'icon-button') {
  const button = element('button', className);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(name));
  return button;
}

function shortened(value, limit = 60) {
  const text = String(value ?? '');
  if (text.length <= limit) return element('span', '', text || 'Not provided');
  const button = element('button', 'shortened', text.slice(0, limit) + '…');
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.title = 'Expand value';
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.textContent = expanded ? text.slice(0, limit) + '…' : text;
    button.setAttribute('aria-expanded', String(!expanded));
    button.title = expanded ? 'Expand value' : 'Collapse value';
  });
  return button;
}

function amazonPrice(value) {
  const key = String(value || '').replace(/^(?:o_|v_|amp_)+/, '');
  return Object.hasOwn(amazonBids, key) ? amazonBids[key] : '';
}

function targetingList(value) {
  const list = element('ul', 'targeting-list');
  const params = new URLSearchParams(value);
  params.sort();
  for (const [key, raw] of params) {
    const item = element('li', featured.has(key) ? 'featured' : '');
    item.append(element('span', 'targeting-key', key), element('span', 'targeting-equals', '='), shortened(raw, 36));
    const extra =
      key === 'amznbid'
        ? amazonPrice(raw)
        : key === 'amznp' && Object.hasOwn(amazonBidders, raw)
          ? amazonBidders[raw]
          : '';
    if (extra !== '') item.append(element('span', 'targeting-note', ` (${extra})`));
    list.append(item);
  }
  return list;
}

function infoRow(label, value, className = '') {
  const row = element('div', `info-row ${className}`);
  row.append(element('span', 'info-label', label), value instanceof Node ? value : shortened(value));
  return row;
}

function entityLink(slot, type, id) {
  const value = String(id || '');
  const network = slot.adUnit.split('/').filter(Boolean)[0]?.split(',');
  if (!/^\d+$/.test(value) || !settings.networkId || !network?.includes(settings.networkId)) {
    return element('span', 'mono', value || 'Not provided');
  }
  const fragments = {
    creative: `creatives/creative/detail/creative_id=${value}`,
    lineitem: `delivery/line_item/detail/line_item_id=${value}&li_tab=settings`,
    order: `delivery/order/order_overview/order_id=${value}`,
    advertiser: `admin/company/detail/company_id=${value}`,
  };
  const link = element('a', 'entity-link mono', value + ' ↗');
  link.href = `https://admanager.google.com/${settings.networkId}#${fragments[type]}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function sizeList(slot) {
  const sizes = element('span', 'size-list slots-sizes');
  const winner = slot.sizeWinner ? `${slot.sizeWinner.width}x${slot.sizeWinner.height}` : '';
  const values = slot.sizes ? slot.sizes.split('|') : [];
  if (winner && !values.includes(winner)) values.push(winner);
  for (const size of values.slice(0, 30)) sizes.append(badge(size, size === winner ? 'size winner' : 'size'));
  if (!values.length) sizes.append(badge('Size unknown', 'size'));
  return sizes;
}

function winnerLabel(slot) {
  if (!slot.advertiserWinner) return null;
  const params = new URLSearchParams(slot.slotTargetings);
  let detail = '';
  if (slot.advertiserWinner === 'prebid') {
    detail = [params.get('hb_bidder'), params.get('hb_pb')].filter(Boolean).join(' · ');
  } else if (slot.advertiserWinner === 'amazon') {
    const bidder = params.get('amznp');
    detail = [Object.hasOwn(amazonBidders, bidder) ? amazonBidders[bidder] : '', amazonPrice(params.get('amznbid'))]
      .filter((value) => value !== '')
      .join(' · ');
  }
  return badge([slot.advertiserWinner, detail].filter(Boolean).join(' · '), 'bidder');
}

function createSlot(slot) {
  const details = element('details', `slot ${getSlotStatus(slot)}`);
  const summary = element('summary', 'slot-summary');
  summary.append(icon('chevron'));
  const name = element('span', 'adunit mono', slot.adUnit);
  name.title = slot.adUnit;
  summary.append(name, sizeList(slot));
  const status = getSlotStatus(slot);
  summary.append(badge(status === 'unknown' ? 'Unknown' : status === 'unfilled' ? 'Unfilled' : 'Filled', status));
  const copy = actionButton('copy', 'Copy ad unit', 'icon-button copy-button');
  copy.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await navigator.clipboard.writeText(slot.adUnit);
      showNotice('Ad unit copied.', 'success');
    } catch {
      showNotice('Clipboard access is unavailable. Select the ad unit to copy it.');
    }
  });
  summary.append(copy);
  details.append(summary);
  const loadBody = () => {
    if (!details.open) return;
    details.append(createSlotBody(slot));
    details.removeEventListener('toggle', loadBody);
  };
  details.addEventListener('toggle', loadBody);
  return details;
}

function createSlotBody(slot) {
  const body = element('div', 'slot-body');
  const ids = element('div', 'entity-grid');
  ids.append(
    infoRow('Creative', entityLink(slot, 'creative', slot.creativeId)),
    infoRow('Line item', entityLink(slot, 'lineitem', slot.lineitemId))
  );
  if (slot.orderId) ids.append(infoRow('Order', entityLink(slot, 'order', slot.orderId)));
  if (slot.advertiserId) ids.append(infoRow('Advertiser', entityLink(slot, 'advertiser', slot.advertiserId)));
  body.append(ids);
  const winner = winnerLabel(slot);
  if (winner) body.append(infoRow('Winning bidder', winner));
  if (slot.slotTargetings)
    body.append(infoRow('Slot targeting', targetingList(slot.slotTargetings), 'slots-targetings'));
  if (slot.video) {
    const video = element('div', 'video-values');
    for (const [key, value] of Object.entries(slot.video)) video.append(badge(`${key}: ${value}`, 'size'));
    body.append(infoRow('Video', video, 'video'));
  }
  return body;
}

function createRequestCard(record) {
  const card = element('details', 'request-card');
  card.open = record.element?.open ?? true;
  const summary = element('summary', 'request-summary');
  summary.append(icon('chevron'), element('span', 'request-number mono', `#${String(record.id).padStart(3, '0')}`));
  const heading = element('span', 'request-heading');
  heading.append(
    element('strong', '', record.slots.some((slot) => slot.video) ? 'Video ad request' : 'Display ad request')
  );
  heading.append(element('span', 'request-endpoint mono', 'Google Ad Manager'));
  summary.append(heading, badge(`${record.slots.length} ${record.slots.length === 1 ? 'slot' : 'slots'}`, 'neutral'));
  if (record.slots.some((slot) => slot.isAnonymous)) summary.append(badge('Privacy signal', 'privacy request-privacy'));
  if (record.httpStatus >= 400 || record.httpStatus === 0)
    summary.append(badge(record.httpStatus ? `HTTP ${record.httpStatus}` : 'Network error', 'unfilled'));
  const time = element(
    'time',
    'request-time mono',
    new Date(record.startedDateTime).toLocaleTimeString([], { hour12: false })
  );
  time.dateTime = record.startedDateTime;
  const duration = record.duration === null ? '—' : `${Math.round(record.duration)} ms`;
  summary.append(element('span', 'request-duration mono', duration), time);
  const body = element('div', 'request-body');
  const first = record.slots[0];
  const privacy = element('div', 'privacy-strip');
  privacy.append(icon('shield'), element('span', '', getPrivacyLabel(first)));
  if (first.gdpr) privacy.append(element('span', 'muted', `GDPR ${first.gdpr}`));
  body.append(privacy);
  if (first.globalTargetings)
    body.append(infoRow('Page targeting', targetingList(first.globalTargetings), 'global-targetings'));
  body.append(infoRow('Consent string', shortened(first.gdprConsent, 48), 'gdpr-consent'));
  if (first.ppid) body.append(infoRow('Publisher ID', shortened(first.ppid, 48), 'ppid'));
  const slotContainer = element('div', 'slots');
  record.slotElements = record.slots.map((slot) => {
    const node = createSlot(slot);
    slotContainer.append(node);
    return node;
  });
  body.append(slotContainer);
  card.append(summary, body);
  return card;
}

function matches(slot) {
  const status = getSlotStatus(slot);
  if (filter === 'filled' && status !== 'filled') return false;
  if (filter === 'unfilled' && status !== 'unfilled') return false;
  if (filter === 'video' && !slot.video) return false;
  if (filter === 'privacy' && !slot.isAnonymous) return false;
  if (!query) return true;
  if (!searchIndexes.has(slot)) {
    const targetings = [...new URLSearchParams(slot.slotTargetings), ...new URLSearchParams(slot.globalTargetings)]
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    searchIndexes.set(
      slot,
      [
        slot.adUnit,
        slot.sizes,
        slot.creativeId,
        slot.lineitemId,
        slot.orderId,
        slot.advertiserId,
        slot.advertiserWinner,
        targetings,
      ]
        .join(' ')
        .toLowerCase()
    );
  }
  return searchIndexes.get(slot).includes(query);
}

function updateFilters() {
  let visibleRequests = 0;
  let visibleSlots = 0;
  for (const record of records) {
    if (!record.element) continue;
    let count = 0;
    record.slots.forEach((slot, index) => {
      const visible = matches(slot);
      record.slotElements[index].hidden = !visible;
      if (visible) count++;
    });
    record.element.hidden = count === 0;
    if (count) visibleRequests++;
    visibleSlots += count;
  }
  document.getElementById('filter-status').textContent = `${visibleRequests} requests · ${visibleSlots} slots`;
  document.getElementById('empty-state').hidden = records.length > 0;
  document.getElementById('no-results').hidden = records.length === 0 || visibleSlots > 0;
  document.getElementById('export').disabled = visibleRequests === 0;
  document.getElementById('clear').disabled = records.length === 0;
}

function updateStats() {
  let count = 0;
  let filled = 0;
  let unfilled = 0;
  let totalDuration = 0;
  let timedRequests = 0;
  for (const record of records) {
    count += record.slots.length;
    for (const slot of record.slots) {
      if (getSlotStatus(slot) === 'filled') filled++;
      if (getSlotStatus(slot) === 'unfilled') unfilled++;
    }
    if (record.duration !== null) {
      totalDuration += record.duration;
      timedRequests++;
    }
  }
  document.getElementById('stat-requests').textContent = records.length.toLocaleString();
  document.getElementById('stat-slots').textContent = count.toLocaleString();
  document.getElementById('stat-fill').textContent =
    filled + unfilled ? `${Math.round((filled / (filled + unfilled)) * 100)}%` : '—';
  document.getElementById('stat-latency').textContent = timedRequests
    ? `${Math.round(totalDuration / timedRequests)} ms`
    : '—';
  document.getElementById('fill-detail').textContent =
    `${filled} filled · ${unfilled} unfilled` +
    (count > filled + unfilled ? ` · ${count - filled - unfilled} unknown` : '');
  document.getElementById('history-limit').textContent = `Last ${settings.maxRequests} requests`;
}

function render() {
  renderFrame = 0;
  records.sort((a, b) => b.id - a.id);
  for (const record of records.splice(settings.maxRequests)) record.element?.remove();
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index];
    if (!record.element) {
      record.element = createRequestCard(record);
      content.insertBefore(record.element, records[index + 1]?.element || content.firstChild);
    }
  }
  updateStats();
  updateFilters();
}

function scheduleRender() {
  if (!renderFrame) renderFrame = requestAnimationFrame(render);
}

function applySettings() {
  applyTheme();
  featured = new Set(settings.featuredTargetings.split(',').filter(Boolean));
  amazonBids = parseJson(settings.amazonBidsJson);
  amazonBidders = parseJson(settings.amazonBiddersJson);
  const advertisers = parseJson(settings.advertisersJson);
  for (const [key, className] of [
    ['hideGdprConsent', 'hide-gdpr-consent'],
    ['hidePpid', 'hide-ppid'],
    ['hideGlobalTargetings', 'hide-global-targetings'],
    ['hideSlotsTargetings', 'hide-slots-targetings'],
    ['hideSlotsSizes', 'hide-slots-sizes'],
    ['hideVideo', 'hide-video'],
  ])
    document.body.classList.toggle(className, settings[key]);
  document.getElementById('preserve-log').checked = settings.preserveLog;
  for (const record of records) {
    if (!record.element) continue;
    for (const slot of record.slots) {
      slot.advertiserWinner = Object.hasOwn(advertisers, slot.advertiserId) ? advertisers[slot.advertiserId] : '';
      searchIndexes.delete(slot);
    }
    const openSlots = record.slotElements.map((slot) => slot.open);
    const replacement = createRequestCard(record);
    record.element.replaceWith(replacement);
    record.element = replacement;
    record.slotElements.forEach((slot, index) => {
      slot.open = openSlots[index];
    });
  }
  scheduleRender();
}

function clearAll() {
  hooks.onClear?.();
  records.length = 0;
  content.replaceChildren();
  render();
}

function resetFilters() {
  query = '';
  filter = 'all';
  document.getElementById('search').value = '';
  for (const button of document.querySelectorAll('[data-filter]'))
    button.setAttribute('aria-pressed', String(button.dataset.filter === 'all'));
  updateFilters();
}

function exportVisible() {
  const visible = records
    .map((record) => ({ ...record, slots: record.slots.filter(matches) }))
    .filter((record) => record.slots.length);
  const blob = new Blob([JSON.stringify(serializeRequests(visible, settings), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = `gam-requests-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showNotice(`Exported ${visible.length} requests. Hidden consent and publisher IDs are omitted.`, 'success');
}

export function initDisplay(callbacks = {}) {
  if (initialized) return;
  initialized = true;
  hooks = callbacks;
  content = document.getElementById('content');
  hydrateIcons();
  applySettings();
  subscribeSettings(applySettings);
  document.getElementById('clear').addEventListener('click', clearAll);
  document.getElementById('export').addEventListener('click', exportVisible);
  document.getElementById('search').addEventListener(
    'input',
    debounce((event) => {
      query = event.target.value.trim().toLowerCase();
      updateFilters();
    }, 120)
  );
  document.getElementById('adunitFilter').addEventListener('submit', (event) => event.preventDefault());
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => {
      filter = button.dataset.filter;
      for (const other of document.querySelectorAll('[data-filter]'))
        other.setAttribute('aria-pressed', String(other === button));
      updateFilters();
    });
  }
  document.getElementById('reset-filters').addEventListener('click', resetFilters);
  document.getElementById('pause').addEventListener('click', () => {
    paused = !paused;
    hooks.onPause?.(paused);
    const button = document.getElementById('pause');
    button.setAttribute('aria-pressed', String(paused));
    button.replaceChildren(icon(paused ? 'play' : 'pause'), element('span', '', paused ? 'Resume' : 'Pause'));
    document.getElementById('capture-status').classList.toggle('paused', paused);
    document.getElementById('capture-label').textContent = paused ? 'Capture paused' : 'Listening for requests';
    document.getElementById('empty-title').textContent = paused ? 'Capture is paused' : 'Ready when your ads are';
  });
  document.getElementById('preserve-log').addEventListener('change', async (event) => {
    try {
      await saveSettings({ preserveLog: event.target.checked });
    } catch {
      event.target.checked = settings.preserveLog;
      showNotice('The preserve log setting could not be saved.');
    }
  });
  for (const button of document.querySelectorAll('[data-action="options"]')) {
    button.addEventListener('click', async () => {
      try {
        if (globalThis.chrome?.runtime?.openOptionsPage) await chrome.runtime.openOptionsPage();
        else window.open(new URL('../../options.html', import.meta.url), '_blank', 'noopener,noreferrer');
      } catch {
        showNotice('Settings could not be opened. Open the extension options from chrome://extensions.');
      }
    });
  }
  document.getElementById('theme').addEventListener('click', async () => {
    const dark =
      settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    try {
      await saveSettings({ theme: dark ? 'light' : 'dark' });
    } catch {
      showNotice('The appearance setting could not be saved.');
    }
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      document.getElementById('search').focus();
    }
    if (event.key === 'Escape' && document.activeElement === document.getElementById('search')) resetFilters();
  });
}

export function displayNavigation(url) {
  if (!settings.preserveLog) {
    records.length = 0;
    content.replaceChildren();
  }
  const location = document.getElementById('page-location');
  try {
    const parsed = new URL(url);
    location.textContent = parsed.host || parsed.protocol;
    location.title = parsed.origin;
  } catch {
    location.textContent = 'Inspected page';
    location.removeAttribute('title');
  }
  scheduleRender();
}

export function displayAdsRequest(slots, metadata = {}) {
  if (!slots.length) return;
  const id = metadata.id ?? ++nextId;
  nextId = Math.max(nextId, id);
  records.push({
    id,
    slots,
    startedDateTime: metadata.startedDateTime || new Date().toISOString(),
    duration: metadata.duration ?? null,
    httpStatus: metadata.httpStatus ?? slots[0].httpStatus ?? 200,
  });
  if (records.length > settings.maxRequests) {
    records.sort((a, b) => b.id - a.id);
    for (const removed of records.splice(settings.maxRequests)) removed.element?.remove();
  }
  scheduleRender();
}

export function showNotice(message, kind = 'info') {
  const notice = document.getElementById('notice');
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, 6500);
}
