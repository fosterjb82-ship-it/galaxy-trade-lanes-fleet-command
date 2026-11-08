// Minimal DOM helpers.
import { art } from '../render/sprites.js';

/** h('div.cls#id', {attrs}, ...children) */
export function h(tag, attrs = {}, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs !== undefined && (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = {};
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/**
 * A DOM canvas showing a piece of game art, rendered at the screen's full
 * resolution so it stays sharp. cssSize is the width in CSS pixels.
 */
export function spriteIcon(key, cssSize = 32) {
  const dpr = window.devicePixelRatio || 1;
  const img = art(key, cssSize * dpr);
  const c = document.createElement('canvas');
  c.className = 'art';
  c.width = img.width;
  c.height = img.height;
  c.style.width = `${img.width / dpr}px`;
  c.style.height = `${img.height / dpr}px`;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}
