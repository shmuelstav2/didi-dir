'use strict';

/** Shared rendering helpers: escaping, dates, modals, toasts, badges. */
const UI = (() => {
  const HE_MONTHS = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יוני', 'יולי', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d)) return '—';
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }

  function fmtShort(v) {
    if (!v) return '—';
    const d = new Date(v);
    if (isNaN(d)) return '—';
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function inputDate(v) {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function monthLabel(key) {
    const [y, m] = String(key).split('-');
    return `${HE_MONTHS[Number(m) - 1] || m}׳${String(y).slice(2)}`;
  }

  function num(v, digits = 0) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
    return Number(v).toLocaleString('he-IL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  const STATUS_LABEL = { active: 'פעיל', sold: 'נמכר', dead: 'מת', culled: 'הוצא' };
  const REPRO_LABEL = { open: 'ריקה', pregnant: 'בהריון', lactating: 'אחרי המלטה', lamb: 'טלה', ram: 'איל' };
  const SEX_LABEL = { F: 'נקבה', M: 'זכר' };
  const DIFFICULTY_LABEL = { normal: 'תקינה', watch: 'מעקב', hard: 'קשה' };
  const STAGE_LABEL = { mating: 'בהרבעה', diagnosis: 'אבחון הריון', pre_lambing: 'לפני המלטה', lambing: 'בהמלטה', done: 'הסתיימה' };
  const EVENT_LABEL = {
    weighing: 'שקילה', pregnancy_check: 'אבחון הריון', vaccination: 'חיסון',
    mating: 'הרבעה', lambing: 'המלטה', treatment: 'טיפול', note: 'הערה',
  };
  const TREATMENT_LABEL = { vaccination: 'חיסון', antibiotic: 'אנטיביוטיקה', weaning: 'גמילה', other: 'אחר' };

  function reproBadge(repro) {
    const cls = repro === 'pregnant' ? 'info' : repro === 'lactating' ? 'ok' : repro === 'lamb' ? 'warn' : '';
    return `<span class="badge ${cls}">${esc(REPRO_LABEL[repro] || repro || '—')}</span>`;
  }

  function difficultyBadge(d) {
    const cls = d === 'hard' ? 'bad' : d === 'watch' ? 'warn' : 'ok';
    return `<span class="badge ${cls}">${esc(DIFFICULTY_LABEL[d] || d)}</span>`;
  }

  // ---------- toasts ----------
  function toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  // ---------- modal ----------
  let onEsc = null;

  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    if (onEsc) { document.removeEventListener('keydown', onEsc); onEsc = null; }
  }

  /**
   * openModal({title, body, submitLabel, onSubmit})
   * onSubmit receives the <form> element; throwing shows the message inline.
   */
  function openModal({ title, body, submitLabel = 'שמירה', onSubmit, wide = false, extraFoot = '' }) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-back" data-close="1">
        <form class="modal" style="${wide ? 'max-width:720px' : ''}">
          <div class="modal-head">
            <h3>${esc(title)}</h3>
            <button type="button" class="x" data-close="1">×</button>
          </div>
          <div class="modal-body">
            <div class="form-err hidden" id="modal-err"></div>
            ${body}
          </div>
          <div class="modal-foot">
            <button type="submit" class="btn btn-primary" id="modal-submit">${esc(submitLabel)}</button>
            <button type="button" class="btn btn-ghost" data-close="1">ביטול</button>
            ${extraFoot}
          </div>
        </form>
      </div>`;

    root.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', ev => { if (ev.target === el) closeModal(); });
    });

    onEsc = ev => { if (ev.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onEsc);

    const form = root.querySelector('form');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const btn = document.getElementById('modal-submit');
      const errBox = document.getElementById('modal-err');
      errBox.classList.add('hidden');
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = 'שומר…';
      try {
        await onSubmit(form);
        closeModal();
      } catch (e) {
        errBox.textContent = e.message;
        errBox.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = label;
      }
    });

    const first = form.querySelector('input, select, textarea');
    if (first) first.focus();
    return form;
  }

  async function confirmDialog(title, message, confirmLabel = 'מחיקה') {
    return new Promise(resolve => {
      openModal({
        title,
        body: `<p style="font-size:13.5px;color:var(--ink-2)">${esc(message)}</p>`,
        submitLabel: confirmLabel,
        onSubmit: async () => { resolve(true); },
      });
      const back = document.querySelector('.modal-back');
      back.addEventListener('click', ev => { if (ev.target === back) resolve(false); });
      document.querySelectorAll('[data-close]').forEach(el =>
        el.addEventListener('click', () => resolve(false)));
      const sub = document.getElementById('modal-submit');
      sub.classList.remove('btn-primary');
      sub.classList.add('btn-danger');
    });
  }

  function field(name, label, opts = {}) {
    const { type = 'text', value = '', required = false, hint = '', cls = '', attrs = '' } = opts;
    return `<div class="fld ${cls}">
      <label for="f-${name}">${esc(label)}</label>
      <input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${attrs}>
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
    </div>`;
  }

  function select(name, label, options, value = '', cls = '') {
    const opts = options.map(o => {
      const v = o.value !== undefined ? o.value : o;
      const l = o.label !== undefined ? o.label : o;
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('');
    return `<div class="fld ${cls}">
      <label for="f-${name}">${esc(label)}</label>
      <select id="f-${name}" name="${name}">${opts}</select>
    </div>`;
  }

  function textarea(name, label, value = '', cls = 'full') {
    return `<div class="fld ${cls}">
      <label for="f-${name}">${esc(label)}</label>
      <textarea id="f-${name}" name="${name}">${esc(value)}</textarea>
    </div>`;
  }

  function formData(form) {
    const out = {};
    new FormData(form).forEach((v, k) => { out[k] = typeof v === 'string' ? v.trim() : v; });
    return out;
  }

  function empty(icon, text) {
    return `<div class="empty"><div class="ico">${icon}</div>${esc(text)}</div>`;
  }

  function pager(page, pages, handlerName) {
    if (pages <= 1) return '';
    const btns = [];
    const from = Math.max(1, page - 2);
    const to = Math.min(pages, from + 4);
    if (page > 1) btns.push(`<button class="pg" onclick="${handlerName}(${page - 1})">‹</button>`);
    for (let i = from; i <= to; i++) {
      btns.push(`<button class="pg ${i === page ? 'active' : ''}" onclick="${handlerName}(${i})">${i}</button>`);
    }
    if (page < pages) btns.push(`<button class="pg" onclick="${handlerName}(${page + 1})">›</button>`);
    return `<div class="pages">${btns.join('')}</div>`;
  }

  return {
    esc, fmtDate, fmtShort, inputDate, monthLabel, num,
    STATUS_LABEL, REPRO_LABEL, SEX_LABEL, DIFFICULTY_LABEL, STAGE_LABEL, EVENT_LABEL, TREATMENT_LABEL,
    reproBadge, difficultyBadge,
    toast, openModal, closeModal, confirmDialog,
    field, select, textarea, formData, empty, pager,
  };
})();
