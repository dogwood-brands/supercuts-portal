// DOM helpers. Text children are always inserted as text nodes, so user content can never become markup.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'text', 'defs', 'linearGradient', 'stop', 'clipPath']);

function append(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
}

/**
 * h('div', { class: 'card', onClick: fn, dataset: { id: 1 }, style: { width: '40%' } }, 'text', node, [nodes])
 * `attrs` may be omitted. `style` is applied through the CSSOM (safe under a strict CSP).
 */
export function h(tag, attrs, ...children) {
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (attrs instanceof Node || typeof attrs === 'string' || typeof attrs === 'number' || Array.isArray(attrs)) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') {
        el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
      } else if (key === 'dataset') {
        for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) el.dataset[k] = v;
      } else if (key === 'style') {
        if (typeof value === 'string') el.style.cssText = value;
        else for (const [k, v] of Object.entries(value)) {
          if (k.startsWith('--')) el.style.setProperty(k, v);
          else el.style[k] = v;
        }
      } else if (key === 'html') {
        el.innerHTML = value; // trusted, static markup only
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        el.setAttribute(key, '');
      } else if (!isSvg && key in el && key !== 'list' && key !== 'form' && typeof value !== 'object') {
        try {
          el[key] = value;
        } catch {
          el.setAttribute(key, value);
        }
      } else {
        el.setAttribute(key, value);
      }
    }
  }
  append(el, children);
  return el;
}

export function frag(...children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Replace the contents of `el` with `child` (node, string, array or null). */
export function mount(el, child) {
  clear(el);
  append(el, child);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Render very simple markdown (headings, lists, bold, paragraphs) into safe DOM nodes.
 * Used for resources and promos written in the admin console. No raw HTML is ever passed through.
 */
export function markdown(src) {
  const root = h('div', { class: 'prose' });
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let list = null;
  let para = [];
  const inline = (text) => {
    const out = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(h('strong', null, m[1]));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };
  const flushPara = () => {
    if (para.length) root.appendChild(h('p', null, inline(para.join(' '))));
    para = [];
  };
  const flushList = () => {
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara();
      flushList();
      root.appendChild(h(m[1].length === 1 ? 'h2' : 'h3', null, inline(m[2])));
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flushPara();
      if (!list || list.tagName !== 'UL') root.appendChild((list = h('ul')));
      list.appendChild(h('li', null, inline(m[1])));
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (!list || list.tagName !== 'OL') root.appendChild((list = h('ol')));
      list.appendChild(h('li', null, inline(m[1])));
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  return root;
}
