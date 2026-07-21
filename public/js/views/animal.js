'use strict';

/** כרטיס חיה — header stats, event timeline, pedigree, offspring. */
const AnimalView = (() => {
  const e = UI.esc;
  let currentTag = null;

  async function render(main, params) {
    currentTag = params.tag;
    main.innerHTML = `<div class="card skeleton" style="height:180px"></div>`;

    const data = await API.get(`/api/animals/${encodeURIComponent(currentTag)}`);
    const a = data.animal;

    main.innerHTML = `
      <div class="crumbs"><button data-nav="flock">ספר עדר</button> · כרטיס חיה</div>

      <div class="card">
        <div class="animal-top">
          <div class="a-avatar" style="font-size:30px">${a.sex === 'M' ? '🐏' : '🐑'}</div>
          <div>
            <h1>${a.sex === 'M' ? 'איל' : 'כבשה'} ${e(a.tag)}${a.name ? ` · ${e(a.name)}` : ''}</h1>
            <div class="meta">
              <span>${e(UI.REPRO_LABEL[a.reproStatus] || '')}</span>
              ${a.groupName ? `<span>קבוצת ${e(a.groupName)}</span>` : ''}
              ${a.breed ? `<span>${e(a.breed)} (גזע)</span>` : ''}
              <span>${e(UI.STATUS_LABEL[a.status] || '')}</span>
            </div>
          </div>
          ${App.canWrite() ? `<div class="actions">
            <button class="btn btn-ghost btn-sm" id="ev-weigh">שקילה</button>
            <button class="btn btn-ghost btn-sm" id="ev-preg">אבחון הריון</button>
            <button class="btn btn-primary btn-sm" id="ev-any">+ אירוע</button>
          </div>` : ''}
        </div>
        <div class="stat-row">
          <div class="stat-c"><div class="l">גיל</div><div class="v">${a.ageYears !== null ? `${UI.num(a.ageYears, 1)} <small>שנים</small>` : '—'}</div></div>
          <div class="stat-c"><div class="l">משקל אחרון</div><div class="v">${a.lastWeightKg ? `${UI.num(a.lastWeightKg, 1)} <small>ק״ג · ${UI.fmtShort(a.lastWeightDate)}</small>` : '—'}</div></div>
          <div class="stat-c"><div class="l">המלטות</div><div class="v">${UI.num(data.stats.lambingCount)} <small>· ${UI.num(data.stats.offspringCount)} ולדות</small></div></div>
          <div class="stat-c"><div class="l">צפי המלטה</div><div class="v">${a.expectedLambingDate
            ? `${UI.fmtShort(a.expectedLambingDate)} <small>· בעוד ${a.daysToLambing} יום</small>`
            : '—'}</div></div>
        </div>
      </div>

      <div class="a-grid">
        <div class="card">
          <div class="card-head"><h2>ציר אירועים</h2><span class="sub">${data.events.length} אירועים</span></div>
          <div class="timeline">${timeline(data.events)}</div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>פרטים וייחוס</h2></div>
            <div class="kv">
              <div class="row"><span>מספר משרד החקלאות</span><b>${e(a.ministryId || '—')}</b></div>
              <div class="row"><span>תאריך לידה</span><b>${UI.fmtDate(a.birthDate)}</b></div>
              <div class="row"><span>גזע</span><b>${e(a.breed || '—')}</b></div>
              <div class="row"><span>אם</span>${data.mother
                ? `<button data-goto="${e(data.mother.tag)}">${e(data.mother.tag)} ←</button>`
                : `<b>${e(a.motherTag || '—')}</b>`}</div>
              <div class="row"><span>אב</span>${data.father
                ? `<button data-goto="${e(data.father.tag)}">${e(data.father.tag)} ←</button>`
                : `<b>${e(a.fatherTag || '—')}</b>`}</div>
              <div class="row"><span>מקור</span><b>${a.origin === 'purchased' ? 'נרכשה' : 'גידול עצמי'}</b></div>
              ${a.notes ? `<div class="row"><span>הערות</span><b>${e(a.notes)}</b></div>` : ''}
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2>צאצאים</h2><span class="sub">${data.offspring.length} רשומים</span></div>
            <div class="kv">${offspring(data.offspring)}</div>
          </div>
        </div>
      </div>`;

    main.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => App.go(el.dataset.nav)));
    main.querySelectorAll('[data-goto]').forEach(el =>
      el.addEventListener('click', () => App.go('animal', { tag: el.dataset.goto })));

    if (App.canWrite()) {
      document.getElementById('ev-weigh').addEventListener('click', () => eventForm('weighing'));
      document.getElementById('ev-preg').addEventListener('click', () => eventForm('pregnancy_check'));
      document.getElementById('ev-any').addEventListener('click', () => eventForm(''));
    }
  }

  function timeline(events) {
    if (!events.length) return UI.empty('🗓', 'אין אירועים רשומים');
    const color = { weighing: 'b', lambing: 'g', pregnancy_check: 'b', vaccination: 'y', mating: 'g', treatment: 'y', note: 'b' };
    const icon = { weighing: '⚖', lambing: '🐑', pregnancy_check: '🔍', vaccination: '💉', mating: '🐏', treatment: '⚕', note: '📝' };
    return events.map(ev => {
      let title = UI.EVENT_LABEL[ev.type] || ev.type;
      const p = ev.payload || {};
      if (ev.type === 'weighing' && p.weightKg) title += ` — ${UI.num(p.weightKg, 1)} ק״ג`;
      if (ev.type === 'pregnancy_check') title += ` — ${p.result === 'positive' ? 'חיובי' : p.result === 'negative' ? 'שלילי' : ''}`;
      if (ev.type === 'lambing') title += ` — ${UI.num(p.offspringCount)} ולדות`;
      if (ev.type === 'vaccination' && p.vaccine) title += ` — ${p.vaccine}`;
      if (ev.type === 'mating' && p.ramTag) title += ` — ${p.ramTag}`;
      const sub = [UI.fmtDate(ev.date), ev.note, p.method, (p.offspringTags || []).join(', ')]
        .filter(Boolean).join(' · ');
      return `<div class="tl-item">
        <span class="tl-dot ${color[ev.type] || 'b'}">${icon[ev.type] || '•'}</span>
        <span class="tx"><b>${e(title)}</b><span>${e(sub)}</span></span>
      </div>`;
    }).join('');
  }

  function offspring(list) {
    if (!list.length) return UI.empty('—', 'אין צאצאים רשומים');
    return list.map(o => `<div class="row">
      <span>${e(o.tag)} · ${e(UI.SEX_LABEL[o.sex])} · ${e(UI.STATUS_LABEL[o.status] || '')}</span>
      <button data-goto="${e(o.tag)}">${UI.fmtShort(o.birthDate)} ←</button>
    </div>`).join('');
  }

  function eventForm(fixedType) {
    const types = [
      { value: 'weighing', label: 'שקילה' }, { value: 'pregnancy_check', label: 'אבחון הריון' },
      { value: 'vaccination', label: 'חיסון' }, { value: 'mating', label: 'הרבעה' },
      { value: 'treatment', label: 'טיפול' }, { value: 'note', label: 'הערה' },
    ];
    const type = fixedType || 'weighing';
    UI.openModal({
      title: `רישום אירוע · ${currentTag}`,
      submitLabel: 'רישום',
      body: `<div class="form-grid">
        ${UI.select('type', 'סוג אירוע', types, type)}
        ${UI.field('date', 'תאריך', { type: 'date', value: UI.inputDate(new Date()), required: true })}
        <div class="full" id="type-fields"></div>
        ${UI.textarea('note', 'הערה', '')}
      </div>`,
      onSubmit: async form => {
        const f = UI.formData(form);
        const payload = {};
        if (f.type === 'weighing') payload.weightKg = Number(f.weightKg);
        if (f.type === 'pregnancy_check') { payload.result = f.result; payload.method = f.method; payload.matingDate = f.matingDate; }
        if (f.type === 'vaccination') payload.vaccine = f.vaccine;
        if (f.type === 'mating') payload.ramTag = f.ramTag;
        if (f.type === 'treatment') payload.treatment = f.treatment;
        await API.post(`/api/animals/${encodeURIComponent(currentTag)}/events`, {
          type: f.type, date: f.date, note: f.note, payload,
        });
        UI.toast('האירוע נרשם');
        App.go('animal', { tag: currentTag });
      },
    });

    const sel = document.getElementById('f-type');
    const box = document.getElementById('type-fields');
    const paint = () => {
      const t = sel.value;
      if (t === 'weighing') box.innerHTML = UI.field('weightKg', 'משקל (ק״ג)', { type: 'number', required: true, attrs: 'step="0.1" min="0"' });
      else if (t === 'pregnancy_check') box.innerHTML = `<div class="form-grid">
        ${UI.select('result', 'תוצאה', [{ value: 'positive', label: 'חיובי' }, { value: 'negative', label: 'שלילי' }], 'positive')}
        ${UI.field('method', 'שיטה', { value: 'אולטרסאונד' })}
        ${UI.field('matingDate', 'תאריך הרבעה (לחישוב צפי המלטה)', { type: 'date', cls: 'full' })}</div>`;
      else if (t === 'vaccination') box.innerHTML = UI.field('vaccine', 'שם החיסון', { value: 'מחומשת' });
      else if (t === 'mating') box.innerHTML = UI.field('ramTag', 'מס׳ איל', {});
      else if (t === 'treatment') box.innerHTML = UI.field('treatment', 'סוג הטיפול', {});
      else box.innerHTML = '';
    };
    sel.addEventListener('change', paint);
    paint();
  }

  return { render };
})();
