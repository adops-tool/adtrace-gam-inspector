import { applyTheme, defaults, saveSettings, settings } from './settings.js';
import { hydrateIcons } from './ui.js';

const form = document.getElementById('options-form');
const saveButton = document.getElementById('save');
const status = document.getElementById('save-status');
const permissions = globalThis.chrome?.permissions;
const mapKeys = ['advertisersJson', 'amazonBidsJson', 'amazonBiddersJson'];

function message(text, error = false) {
  status.textContent = text;
  status.classList.toggle('error', error);
}

function fillForm(values) {
  for (const key of Object.keys(defaults)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = values[key];
    else field.value = mapKeys.includes(key) ? JSON.stringify(JSON.parse(values[key]), null, 2) : values[key];
  }
}

function validateMap(field) {
  field.setCustomValidity('');
  let parsed;
  try {
    parsed = JSON.parse(field.value.trim() || '{}');
  } catch {
    field.setCustomValidity('Enter valid JSON, for example {"123":"prebid"}.');
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    field.setCustomValidity('Enter a JSON object containing key/value pairs.');
    return null;
  }
  for (const [key, value] of Object.entries(parsed)) {
    const valid =
      field.name === 'amazonBidsJson'
        ? typeof value === 'number' && Number.isFinite(value) && value >= 0
        : typeof value === 'string';
    if (['__proto__', 'constructor', 'prototype'].includes(key) || !valid) {
      field.setCustomValidity(
        field.name === 'amazonBidsJson'
          ? 'Each bid price must be a non-negative number. Reserved keys are not allowed.'
          : 'Each name must be a string. Reserved keys are not allowed.'
      );
      return null;
    }
  }
  return JSON.stringify(parsed);
}

async function renderPermissions() {
  const list = document.getElementById('allowed-sites');
  list.replaceChildren();
  if (!permissions) {
    document.getElementById('grant-site').disabled = true;
    return;
  }
  const granted = await permissions.getAll();
  const origins = granted.origins || [];
  document.getElementById('site-empty').hidden = origins.length > 0;
  for (const origin of origins) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = origin;
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.className = 'text-button';
    revoke.textContent = 'Revoke';
    revoke.setAttribute('aria-label', `Revoke access to ${origin}`);
    revoke.addEventListener('click', async () => {
      try {
        await permissions.remove({ origins: [origin] });
        await renderPermissions();
        message('Site access revoked. Reload that page to remove any remaining overlays.');
      } catch {
        message('Site access could not be revoked.', true);
      }
    });
    item.append(name, revoke);
    list.append(item);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    values[key] =
      typeof fallback === 'boolean'
        ? field.checked
        : typeof fallback === 'number'
          ? Number(field.value)
          : field.value.trim();
  }
  for (const key of mapKeys) values[key] = validateMap(form.elements.namedItem(key));
  if (!form.reportValidity()) return;
  saveButton.disabled = true;
  try {
    if (values.showOverlay) {
      const granted = await permissions?.getAll();
      if (!granted?.permissions?.includes('scripting') || !granted.origins?.length) {
        message('Allow at least one site below before enabling slot overlays.', true);
        document.getElementById('overlay-site').focus();
        return;
      }
    }
    await saveSettings(values);
    applyTheme();
    message('Settings saved. Open inspector panels update automatically.');
    form.dataset.dirty = 'false';
  } catch {
    message('Settings could not be saved. Please try again.', true);
  } finally {
    saveButton.disabled = false;
  }
});

form.addEventListener('input', (event) => {
  event.target.setCustomValidity?.('');
  form.dataset.dirty = 'true';
  message('You have unsaved changes.');
});

document.getElementById('grant-site').addEventListener('click', async () => {
  const input = document.getElementById('overlay-site');
  input.setCustomValidity('');
  let pattern;
  try {
    const url = new URL(input.value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hostname.includes('*'))
      throw new Error();
    pattern = `${url.protocol}//${url.hostname}/*`;
  } catch {
    input.setCustomValidity('Enter a site URL, for example https://example.com.');
    input.reportValidity();
    return;
  }
  try {
    const granted = await permissions.request({ permissions: ['scripting'], origins: [pattern] });
    if (!granted) {
      message('Site access was not granted.', true);
      return;
    }
    await renderPermissions();
    message('Site access granted. Enable slot overlays and save your settings.');
    input.value = '';
  } catch {
    message('Site access could not be requested. Open this page from the installed extension.', true);
  }
});

hydrateIcons();
applyTheme();
fillForm(settings);
void renderPermissions().catch(() => message('Site permissions could not be loaded.', true));
