'use strict';
// Command palette — ⌘K/⌘P open a centered fuzzy finder over the Console actions.
// Console wires it via Palette.init(commands); each command is {title, run, hint?}.
// Fuzzy match = substring OR subsequence over the title (case-insensitive).

const Palette = (() => {
  let cmds = [], shown = [], sel = 0, open = false, lastFocus = null;
  let root, input, listEl;

  function build() {
    root = document.createElement('div');
    root.id = 'palette'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Command palette');
    root.innerHTML =
      '<div id="pal-box">' +
      '<input id="pal-input" type="text" autocomplete="off" spellcheck="false"' +
      ' placeholder="Type a command…" aria-label="Search commands"' +
      ' aria-controls="pal-list" aria-activedescendant="" />' +
      '<div id="pal-list" role="listbox" aria-label="Commands"></div>' +
      '</div>';
    document.body.appendChild(root);
    input = root.querySelector('#pal-input');
    listEl = root.querySelector('#pal-list');
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    input.addEventListener('input', () => { sel = 0; filter(); });
    input.addEventListener('keydown', onKey);
  }

  // subsequence: every char of q appears in t in order
  function subseq(q, t) {
    let i = 0;
    for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
    return i === q.length;
  }
  function match(q, title) {
    if (!q) return true;
    const t = title.toLowerCase();
    return t.includes(q) || subseq(q, t);
  }
  function filter() {
    const q = input.value.trim().toLowerCase();
    shown = cmds.filter((c) => match(q, c.title));
    if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
    render();
  }
  function render() {
    listEl.innerHTML = '';
    if (!shown.length) {
      const e = document.createElement('div'); e.className = 'pal-empty';
      e.textContent = 'No matching command.'; listEl.appendChild(e);
      input.setAttribute('aria-activedescendant', '');
      return;
    }
    shown.forEach((c, i) => {
      const d = document.createElement('div');
      d.className = 'pal-item' + (i === sel ? ' sel' : '');
      d.id = 'pal-item-' + i; d.setAttribute('role', 'option');
      d.setAttribute('aria-selected', i === sel ? 'true' : 'false');
      const t = document.createElement('span'); t.className = 'pal-t'; t.textContent = c.title;
      d.appendChild(t);
      if (c.hint) { const h = document.createElement('span'); h.className = 'pal-h'; h.textContent = c.hint; d.appendChild(h); }
      d.addEventListener('mousemove', () => { if (sel !== i) { sel = i; render(); } });
      d.addEventListener('click', () => choose(i));
      listEl.appendChild(d);
    });
    const cur = listEl.children[sel];
    input.setAttribute('aria-activedescendant', cur ? cur.id : '');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (shown.length) { sel = (sel + 1) % shown.length; render(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (shown.length) { sel = (sel - 1 + shown.length) % shown.length; render(); } }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Tab') { e.preventDefault(); } // focus-trap: the input is the only focusable; never let Tab escape the modal
  }
  function choose(i) {
    const c = shown[i]; if (!c) return;
    close();
    try { c.run(); } catch {}
  }

  function open_() {
    if (open) return;
    open = true; lastFocus = document.activeElement;
    document.getElementById('side')?.setAttribute('aria-hidden', 'true'); // truly modal for assistive tech
    document.getElementById('main')?.setAttribute('aria-hidden', 'true');
    sel = 0; input.value = ''; root.hidden = false;
    filter();
    input.focus();
  }
  function close() {
    if (!open) return;
    open = false; root.hidden = true;
    document.getElementById('side')?.removeAttribute('aria-hidden');
    document.getElementById('main')?.removeAttribute('aria-hidden');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch {} }
    lastFocus = null;
  }

  return {
    init(commands) { cmds = commands || []; if (!root) build(); },
    open: open_,
    close,
    toggle() { open ? close() : open_(); },
    isOpen() { return open; },
  };
})();
