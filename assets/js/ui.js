const paths = {
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v4h16v-4',
  trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
  pause: 'M8 5v14M16 5v14',
  play: 'M8 4l12 8-12 8z',
  moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1',
  copy: 'M9 9h12v12H9zM15 9V3H3v12h6',
  chevron: 'M9 5l7 7-7 7',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M5 12l4 4L19 6',
  shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6',
  layers: 'M12 3l10 6-10 6L2 9zM2 14l10 6 10-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2',
  close: 'M6 6l12 12M6 18L18 6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v6M12 7v1',
};

export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name] || paths.info);
  svg.append(path);
  return svg;
}

export function hydrateIcons(root = document) {
  for (const element of root.querySelectorAll('[data-icon]')) element.replaceChildren(icon(element.dataset.icon));
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
