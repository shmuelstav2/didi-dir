'use strict';

/** תכנון המלטות — breeding groups with stage tracking, forecast, treatment calendar. */
const PlanningView = (() => {
  const e = UI.esc;
  const STAGES = ['mating', 'diagnosis', 'pre_lambing', 'lambing'];
  const STAGE_SHORT = { mating: 'הרבעה', diagnosis: 'אבחון הריון', pre_lambing: 'לפני המלטה', lambing: 'המלטה' };

  async function render(main) {
    main.innerHTML = `<div class="card skeleton" style="height:160px"></div>`;
    const [g, f, t] = await Promise.all([
      API.get('/api/breeding/groups'),
      API.get('/api/breeding/forecast'),
      API.get('/api/breeding/treatments'),
    ]);

    main.innerHTML = `
      <div class="page-head">
        <div>
          <h1>תכנון המלטות</h1>
          <p>${UI.num(f.activeGroups)} קבוצות הרבעה פעילות · צפי ${UI.num(f.totalExpected)} המלטות בחצי השנה הקרובה</p>
        </div>
        <div class="actions">
          ${App.canWrite() ? `<button class="btn btn-ghost" id="add-treatment">+ טיפול</button>
          <button class="btn btn-primary" id="add-group">+ קבוצת הרבעה</button>` : ''}
        </div>
      </div>

      <div class="plan-grid">${groupCards(g.groups)}</div>

      <div class="grid">
        <div class="card">
          <div class="card-head"><h2>תחזית המלטות</h2><span class="sub">6 חודשים קדימה · לפי אבחוני הריון</span></div>
          ${forecastChart(f.forecast)}
        </div>
        <div class="card">
          <div class="card-head"><h2>יומן טיפולים</h2><span class="sub">${t.treatments.filter(x => x.status !== 'done').length} פתוחים</span></div>
          <div class="treat-list">${treatmentList(t.treatments)}</div>
        </div>
      </div>`;

    if (App.canWrite()) {
      document.getElementById('add-group').addEventListener('click', () => groupForm());
      document.getElementById('add-treatment').addEventListener('click', () => treatmentForm());
      main.querySelectorAll('[data-edit-group]').forEach(b =>
        b.addEventListener('click', () => {
          const grp = g.groups.find(x => String(x._id) === b.dataset.editGroup);
          groupForm(grp);
        }));
      main.querySelectorAll('[data-done]').forEach(b =>
        b.addEventListener('click', async () => {
          await API.put(`/api/breeding/treatments/${b.dataset.done}`, { status: 'done' });
          UI.toast('הטיפול סומן כבוצע');
          App.go('planning');
        }));
    }
  }

  function groupCards(groups) {
    if (!groups.length) return `<div class="card">${UI.empty('📅', 'אין קבוצות הרבעה. הוסיפו קבוצה כדי להתחיל בתכנון.')}</div>`;
    return groups.map(g => {
      const idx = STAGES.indexOf(g.stage);
      const steps = STAGES.map((s, i) => {
        const cls = i < idx ? 'done' : i === idx ? 'now' : '';
        return `<div class="step ${cls}"><span class="p"></span><span>${STAGE_SHORT[s]}</span></div>`;
      }).join('');
      const badge = g.stage === 'pre_lambing' && g.daysToLambing !== null && g.daysToLambing >= 0
        ? `<span class="badge warn">צפי: בעוד ${g.daysToLambing} יום</span>`
        : `<span class="badge ${g.stage === 'done' ? '' : 'ok'}">${e(UI.STAGE_LABEL[g.stage])}</span>`;
      return `<div class="card plan-card">
        <h3>${e(g.name)} ${badge}</h3>
        <div class="meta">${UI.num(g.femaleCount)} אמהות · ${e((g.rams || []).join(', ') || 'ללא איל')} ·
          הרבעה ${UI.fmtShort(g.matingStart)}–${UI.fmtShort(g.matingEnd)}</div>
        <div class="steps">${steps}</div>
        <div class="foot">
          <span>${g.pregnantCount ? `התעברות <b>${g.pregnantCount}/${g.femaleCount} · ${g.conceptionRate}%</b>`
            : `צפי המלטה <b>${UI.fmtShort(g.expectedLambingDate)}</b>`}</span>
          ${App.canWrite() ? `<button class="pill-link" data-edit-group="${e(g._id)}">עריכה</button>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function forecastChart(forecast) {
    if (!forecast.length) return `<div class="chart">${UI.empty('📊', 'אין תחזית זמינה')}</div>`;
    const max = Math.max(...forecast.map(f => f.mothers), 1);
    return `<div class="chart">
      <div class="bars">
        <div class="gridline" style="top:0"></div><div class="gridline" style="top:50%"></div>
        ${forecast.map((f, i) => `<div class="bar-col" title="${e(f.groups.join(', '))}">
          <div class="cbar ${i === 0 ? 'now' : 'fut'}" style="height:${Math.max(4, f.mothers / max * 100)}%">
            <span class="bar-lbl">${f.mothers}</span></div></div>`).join('')}
      </div>
      <div class="x-lbls">${forecast.map(f => `<span>${e(UI.monthLabel(f.month))}</span>`).join('')}</div>
    </div>`;
  }

  function treatmentList(list) {
    if (!list.length) return UI.empty('✓', 'אין טיפולים ביומן');
    const icon = { vaccination: '💉', antibiotic: '⚕', weaning: '🌾', other: '📋' };
    return list.slice(0, 8).map(t => {
      const days = Math.round((new Date(t.date) - new Date()) / 86400000);
      const when = t.status === 'done' ? 'בוצע'
        : days < 0 ? `באיחור ${-days} ימים` : days === 0 ? 'היום' : days === 1 ? 'מחר' : `בעוד ${days} ימים`;
      const cls = t.status === 'done' ? '' : days < 0 ? 'bad' : t.status === 'in_progress' ? 'warn' : 'ok';
      return `<div class="treat">
        <span class="t-ico">${icon[t.type] || '📋'}</span>
        <span class="tx"><b>${e(t.title)}</b><span>${UI.fmtShort(t.date)}${t.count ? ` · ${UI.num(t.count)} ראשים` : ''}${t.groupName ? ` · ${e(t.groupName)}` : ''}</span></span>
        <span class="badge ${cls}">${e(when)}</span>
        ${App.canWrite() && t.status !== 'done' ? `<button class="pill-link" style="margin-inline-start:8px" data-done="${e(t._id)}">סיום</button>` : ''}
      </div>`;
    }).join('');
  }

  function groupForm(group = null) {
    const g = group || {};
    UI.openModal({
      title: group ? `עריכת ${g.name}` : 'קבוצת הרבעה חדשה',
      wide: true,
      submitLabel: group ? 'עדכון' : 'יצירה',
      body: `<div class="form-grid">
        ${UI.field('name', 'שם הקבוצה', { value: g.name || '', required: true })}
        ${UI.field('rams', 'אילים (מופרד בפסיק)', { value: (g.rams || []).join(', ') })}
        ${UI.field('femaleCount', 'מספר אמהות', { type: 'number', value: g.femaleCount ?? '', attrs: 'min="0"' })}
        ${UI.field('pregnantCount', 'אובחנו בהריון', { type: 'number', value: g.pregnantCount ?? '', attrs: 'min="0"' })}
        ${UI.field('matingStart', 'תחילת הרבעה', { type: 'date', value: UI.inputDate(g.matingStart) })}
        ${UI.field('matingEnd', 'סיום הרבעה', { type: 'date', value: UI.inputDate(g.matingEnd) })}
        ${UI.select('stage', 'שלב', [
          { value: 'mating', label: 'בהרבעה' }, { value: 'diagnosis', label: 'אבחון הריון' },
          { value: 'pre_lambing', label: 'לפני המלטה' }, { value: 'lambing', label: 'בהמלטה' },
          { value: 'done', label: 'הסתיימה' },
        ], g.stage || 'mating')}
        ${UI.field('expectedLambingDate', 'צפי המלטה', { type: 'date', value: UI.inputDate(g.expectedLambingDate), hint: 'ריק = חישוב אוטומטי (150 יום מתחילת ההרבעה)' })}
        ${UI.textarea('notes', 'הערות', g.notes || '')}
      </div>`,
      extraFoot: group ? `<button type="button" class="btn btn-danger spacer" id="del-group">מחיקה</button>` : '',
      onSubmit: async form => {
        const f = UI.formData(form);
        f.rams = (f.rams || '').split(',').map(s => s.trim()).filter(Boolean);
        if (group) await API.put(`/api/breeding/groups/${g._id}`, f);
        else await API.post('/api/breeding/groups', f);
        UI.toast(group ? 'הקבוצה עודכנה' : 'הקבוצה נוצרה');
        App.go('planning');
      },
    });

    const del = document.getElementById('del-group');
    if (del) del.addEventListener('click', async () => {
      UI.closeModal();
      if (!await UI.confirmDialog('מחיקת קבוצה', `למחוק את ${g.name}?`)) return;
      await API.del(`/api/breeding/groups/${g._id}`);
      UI.closeModal();
      UI.toast('הקבוצה נמחקה');
      App.go('planning');
    });
  }

  function treatmentForm() {
    UI.openModal({
      title: 'טיפול חדש',
      submitLabel: 'הוספה',
      body: `<div class="form-grid">
        ${UI.field('title', 'כותרת', { required: true, cls: 'full' })}
        ${UI.select('type', 'סוג', [
          { value: 'vaccination', label: 'חיסון' }, { value: 'antibiotic', label: 'אנטיביוטיקה' },
          { value: 'weaning', label: 'גמילה' }, { value: 'other', label: 'אחר' },
        ], 'vaccination')}
        ${UI.field('date', 'תאריך', { type: 'date', value: UI.inputDate(new Date()), required: true })}
        ${UI.field('groupName', 'קבוצה', {})}
        ${UI.field('count', 'מספר ראשים', { type: 'number', attrs: 'min="0"' })}
        ${UI.select('status', 'סטטוס', [
          { value: 'planned', label: 'מתוכנן' }, { value: 'in_progress', label: 'בטיפול' }, { value: 'done', label: 'בוצע' },
        ], 'planned')}
        ${UI.textarea('notes', 'הערות', '')}
      </div>`,
      onSubmit: async form => {
        await API.post('/api/breeding/treatments', UI.formData(form));
        UI.toast('הטיפול נוסף ליומן');
        App.go('planning');
      },
    });
  }

  return { render };
})();
