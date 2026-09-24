// The design system's dropdown menu (TB.menu in the shared toolbox), as a
// React component. A popover on the body, positioned from the trigger's
// viewport rect, with an optional find box above a scrolling list.
//
// Items: '-' is a divider, { header, label } a group label, anything else a
// button with label, selected (boolean or function), onClick, keepOpen,
// alwaysShow (a control that stays put while a query narrows the list) and
// disabled. A checkable list works through several items before it is done,
// so keepOpen leaves the menu up and the ticks repaint in place.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

const GAP = 8, EDGE = 8;

export default function Menu({ trigger, items, open, onClose, align = 'left', search = null }) {
  const host = useRef(null);
  const list = useRef(null);
  const field = useRef(null);
  const [q, setQ] = useState('');
  const isSel = (it) => (typeof it.selected === 'function' ? Boolean(it.selected()) : Boolean(it.selected));

  useEffect(() => { if (!open) setQ(''); }, [open]);

  // Place it, then cap the list to the room that is actually there: the
  // larger gap around the trigger, flipping above when below is too tight.
  useLayoutEffect(() => {
    if (!open || !host.current || !trigger?.current) return undefined;
    const el = host.current, t = trigger.current;
    const r = t.getBoundingClientRect(), w = el.offsetWidth;
    el.style.left = `${Math.max(EDGE, Math.min(window.innerWidth - w - EDGE, align === 'right' ? r.right - w : r.left))}px`;
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const flip = below < 180 && above > below;
    const chrome = el.querySelector('.th-menu-search')?.offsetHeight || 0;
    if (list.current) list.current.style.maxHeight = `${Math.max(120, (flip ? above : below) - chrome)}px`;
    el.style.top = `${flip ? Math.max(EDGE, r.top - GAP - el.offsetHeight) : r.bottom + GAP}px`;
    t.setAttribute('data-state', 'open');
    // Not on touch: the keyboard would cover the list the find box is there
    // to narrow.
    if (field.current && window.matchMedia('(pointer: fine)').matches) setTimeout(() => field.current && field.current.focus(), 0);
    return () => t.removeAttribute('data-state');
  }, [open, align, trigger]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (host.current && !host.current.contains(e.target) && !trigger?.current?.contains(e.target)) onClose(); };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      if (field.current && field.current.value) { setQ(''); field.current.focus(); return; }
      onClose();
    };
    // Scroll does not bubble and the card is the scroller, so capture phase.
    // A wheel inside the menu is the menu scrolling, not the page moving.
    const scroll = (e) => {
      const t = e && e.target;
      if (t && t.nodeType && host.current?.contains(t)) return;
      // Typing in the find box can make a phone nudge the page to keep the
      // field in view. That is not the reader moving away from the menu.
      if (host.current?.contains(document.activeElement)) return;
      onClose();
    };
    // A phone keyboard opening changes the height, not the width.
    const width = window.innerWidth;
    const resize = () => { if (window.innerWidth !== width) onClose(); };
    const id = setTimeout(() => {
      document.addEventListener('pointerdown', away);
      document.addEventListener('keydown', key);
      window.addEventListener('scroll', scroll, true);
      window.addEventListener('resize', resize);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open, onClose, trigger]);

  if (!open || typeof document === 'undefined') return null;

  const query = q.trim().toLowerCase();
  const visible = (it) => !query || it.alwaysShow || String(it.label || '').toLowerCase().includes(query);
  const entries = items.filter((it) => it && it !== '-' && !it.header && !it.alwaysShow);
  const hits = entries.filter(visible);
  // A group label stays only while something under it is showing.
  const headerShown = (i) => {
    if (!query) return true;
    for (let j = i + 1; j < items.length; j++) {
      const it = items[j];
      if (!it || it === '-') continue;
      if (it.header) return false;
      if (visible(it)) return true;
    }
    return false;
  };
  const pick = (it) => {
    if (!it || it.disabled) return;
    if (it.keepOpen) { if (typeof it.onClick === 'function') it.onClick(); return; }
    onClose();
    if (typeof it.onClick === 'function') it.onClick();
  };
  const onKey = (e) => { if (e.key === 'Enter' && hits.length === 1) { e.preventDefault(); pick(hits[0]); } };

  return createPortal(
    <div className="th-popover th-surface" ref={host} role="menu">
      {search ? (
        <div className="th-menu-search">
          <div className="th-field th-field-search">
            <span className="th-field-body">
              <Icon name="search" size={12} />
              <input ref={field} type="text" className="th-menu-search-input" autoComplete="off" spellCheck={false} placeholder={search} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
            </span>
          </div>
        </div>
      ) : null}
      <div className="th-menu" ref={list}>
        {items.map((it, i) => {
          if (it === '-') return <div key={i} className="th-menu-divider" hidden={Boolean(query)} />;
          if (!it) return null;
          if (it.header) return <div key={i} className="th-menu-label typ-label-xxsmall" hidden={!headerShown(i)}>{it.label}</div>;
          const sel = isSel(it);
          return (
            <button type="button" key={i} className={`th-menu-item typ-label-medium${sel ? ' is-selected' : ''}`} aria-disabled={it.disabled ? 'true' : undefined} hidden={!visible(it)} onClick={() => pick(it)} role="menuitemcheckbox" aria-checked={sel}>
              {sel ? <Icon name="check" size={12} /> : null}{it.label}
            </button>
          );
        })}
        <div className="th-menu-empty typ-label-medium" hidden={!(query && hits.length === 0)}>No match for “{q.trim()}”</div>
      </div>
    </div>,
    document.body,
  );
}
