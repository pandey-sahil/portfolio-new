// Per-letter hover reveal (the "split text" trick popularized by lettering.js
// + a GSAP stagger), reimplemented with no dependencies: each character's
// text node becomes a small overflow-hidden window holding two stacked
// copies of the glyph (the visible one, and a CSS `content: attr()` copy
// sitting directly below it). Hover slides the window up by its own height,
// so the real letter exits the top while the duplicate rides in from the
// bottom — a pure CSS transition, staggered per letter via a `--i` custom
// property, no animation library needed.
//
// Only text nodes are touched — an icon `<svg>` sitting next to a label
// (e.g. CardNav's nav-card-link) is left exactly where it is.

function splitTextNodes(el: HTMLElement) {
  let i = 0;
  Array.from(el.childNodes).forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = (node.textContent ?? '').trim();
    if (!text) return;

    // Wrapped in one `.split-text` span rather than dropped in as loose
    // siblings: an ancestor like `.nav-card-link` is a flex row with `gap`
    // between the icon and the label, and loose letter-spans would each
    // become their own flex child — turning that one gap into a gap after
    // *every letter*. One wrapper keeps the icon+label gap count at one.
    const wrapper = document.createElement('span');
    wrapper.className = 'split-text';
    for (const ch of text) {
      const glyph = ch === ' ' ? ' ' : ch;
      const outer = document.createElement('span');
      outer.className = 'split-char';
      const inner = document.createElement('span');
      inner.className = 'split-char-inner';
      inner.textContent = glyph;
      inner.setAttribute('data-letter', glyph);
      inner.style.setProperty('--i', String(i++));
      outer.appendChild(inner);
      wrapper.appendChild(outer);
    }
    node.replaceWith(wrapper);
  });
}

export function initSplitHover(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.split-hover').forEach((el) => {
    if (el.dataset.splitReady) return;
    el.dataset.splitReady = 'true';
    splitTextNodes(el);
  });
}
