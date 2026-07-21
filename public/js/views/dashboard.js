'use strict';

/** תמונת מצב — live KPIs, alerts, lambing chart, treatment list. */
const DashboardView = (() => {
  const e = UI.esc;

  async function render(main) {
    main.innerHTML = `<div class="hero skeleton" style="height:104px"></div>
      <div class="tiles">${'<div class="tile skeleton" style="height:86px"></div>'.repeat(5)}</div>`;

    const [d, stats] = await Promise.all([
      API.get('/api/dashboard'),
      API.get('/api/lambings/stats'),
    ]);

    const hour = new Date().getHours();
    const greet = hour < 12 ? 'בוקר טוב' : hour < 18 ? 'צהריים טובים' : 'ערב טוב';
    const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

    main.innerHTML = `
      <section class="hero">
        <div>
          <h1>${e(greet)}, ${e(App.user.name)} 🌿</h1>
          <p>${e(today)} · עונת המלטות ${e(d.season)} · חוות גבעת האלה</p>
        </div>
        <div class="hero-num">
          <div class="n">${UI.num(d.headcount)}</div>
          <div class="l">ראשים בעדר · ‎+${UI.num(d.addedThisSeason)} מתחילת העונה</div>
        </div>
      </section>

      <div class="alerts">${alerts(d)}</div>

      <div class="tiles">
        <div class="tile" data-nav="flock"><div class="lbl">אמהות</div><div class="val">${UI.num(d.composition.females)}</div><div class="pct">${UI.num(d.composition.pregnant)} בהריון</div></div>
        <div class="tile" data-nav="flock"><div class="lbl">טלאים</div><div class="val">${UI.num(d.composition.lambs)}</div><div class="pct">עד גמילה</div></div>
        <div class="tile" data-nav="lambings"><div class="lbl">המלטות העונה</div><div class="val">${UI.num(d.lambing.count)}</div><div class="pct">${UI.num(d.lambing.offspring)} ולדות</div></div>
        <div class="tile" data-nav="lambings"><div class="lbl">אחוז המלטה</div><div class="val">${UI.num(d.lambing.rate)}%</div>
          <div class="bar"><i style="width:${Math.min(100, d.lambing.rate)}%;background:var(--brand-600)"></i></div></div>
        <div class="tile static"><div class="lbl">ולדות לאם</div><div class="val">${UI.num(d.lambing.perMother, 1)}</div><div class="pct">ממוצע העונה</div></div>
      </div>

      <div class="grid">
        <div class="card">
          <div class="card-head">
            <h2>המלטות</h2><span class="sub">עונת ${e(d.season)}</span>
            <button class="lnk" data-nav="lambings">כל ההמלטות ←</button>
          </div>
          <div class="kpis">
            <div class="kpi"><div class="lbl">המלטות העונה</div><div class="val">${UI.num(stats.lambings)}</div></div>
            <div class="kpi"><div class="lbl">אחוז המלטה</div><div class="val">${UI.num(stats.lambingRate)}<small>%</small></div></div>
            <div class="kpi"><div class="lbl">ולדות לאם</div><div class="val">${UI.num(stats.offspringPerMother, 1)}</div></div>
            <div class="kpi"><div class="lbl">משקל לידה</div><div class="val">${UI.num(stats.avgBirthWeight, 1)}<small> ק״ג</small></div></div>
          </div>
          ${chart(stats.byMonth)}
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>תמותה</h2><span class="sub">מתחילת העונה</span></div>
            <div class="mort-top">
              <div class="big">${UI.num(d.mortality.count)}</div>
              <div class="pct">${UI.num(d.mortality.pct, 1)}% מהעדר</div>
            </div>
            <div class="meters">
              <div class="meter">
                <div class="row"><span>תמותת ולדות</span><b>${UI.num(stats.deadOffspring)} · ${UI.num(stats.offspringMortality, 1)}%</b></div>
                <div class="track"><i class="fill" style="display:block;width:${Math.min(100, stats.offspringMortality * 6)}%"></i></div>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <h2>טיפולים</h2><span class="sub">${UI.num(d.treatments.open)} פתוחים</span>
              <button class="lnk" data-nav="planning">ליומן ←</button>
            </div>
            <div class="treat-list">${treatments(d.treatments.upcoming)}</div>
          </div>
        </div>
      </div>`;

    main.querySelectorAll('[data-nav]').forEach(el =>
      el.addEventListener('click', () => App.go(el.dataset.nav)));
  }

  function alerts(d) {
    const items = [];
    if (d.nextGroup) {
      items.push({
        cls: 'ok', ico: '🐑',
        html: `<b>${e(d.nextGroup.name)}</b> · ${d.nextGroup.daysToLambing >= 0
          ? `צפי המלטה בעוד ${UI.num(d.nextGroup.daysToLambing)} יום`
          : 'בהמלטה'}`,
        nav: 'planning',
      });
    }
    for (const t of (d.treatments.upcoming || []).slice(0, 2)) {
      const days = Math.round((new Date(t.date) - new Date()) / 86400000);
      items.push({
        cls: t.status === 'in_progress' ? 'bad' : 'warn', ico: t.status === 'in_progress' ? '⚕' : '💉',
        html: `<b>${e(t.title)}</b> · ${t.count ? `${UI.num(t.count)} ראשים · ` : ''}${days <= 0 ? 'היום' : days === 1 ? 'מחר' : `בעוד ${days} ימים`}`,
        nav: 'planning',
      });
    }
    if (d.weaningSoon) {
      items.push({ cls: 'ok', ico: '🌾', html: `<b>${UI.num(d.weaningSoon)} טלאים</b> · מגיעים לגיל גמילה השבוע`, nav: 'flock' });
    }
    if (!items.length) return `<div class="alert"><span class="a-ico ok">✓</span><span>אין התראות פתוחות</span></div>`;
    return items.map(i =>
      `<div class="alert" data-nav="${i.nav}"><span class="a-ico ${i.cls}">${i.ico}</span><span>${i.html}</span></div>`).join('');
  }

  function treatments(list) {
    if (!list || !list.length) return UI.empty('✓', 'אין טיפולים פתוחים');
    return list.map(t => {
      const days = Math.round((new Date(t.date) - new Date()) / 86400000);
      const when = days < 0 ? `לפני ${-days} ימים` : days === 0 ? 'היום' : days === 1 ? 'מחר' : `בעוד ${days} ימים`;
      const badge = t.status === 'in_progress'
        ? '<span class="badge warn">בטיפול</span>'
        : `<span class="badge ok">${e(when)}</span>`;
      return `<div class="treat">
        <span class="t-ico">${t.type === 'vaccination' ? '💉' : t.type === 'antibiotic' ? '⚕' : t.type === 'weaning' ? '🌾' : '📋'}</span>
        <span class="tx"><b>${e(t.title)}</b><span>${t.count ? `${UI.num(t.count)} ראשים` : ''}${t.groupName ? ` · ${e(t.groupName)}` : ''}</span></span>
        ${badge}
      </div>`;
    }).join('');
  }

  function chart(byMonth) {
    if (!byMonth || !byMonth.length) return `<div class="chart">${UI.empty('📊', 'אין המלטות בעונה הנוכחית')}</div>`;
    const max = Math.max(...byMonth.map(m => m.count), 1);
    const cols = byMonth.map(m =>
      `<div class="bar-col" title="${e(UI.monthLabel(m.month))}: ${m.count}">
        <div class="cbar" style="height:${Math.max(4, m.count / max * 100)}%"><span class="bar-lbl">${m.count}</span></div>
      </div>`).join('');
    const labels = byMonth.map(m => `<span>${e(UI.monthLabel(m.month))}</span>`).join('');
    return `<div class="chart">
      <div class="bars">
        <div class="gridline" style="top:0"></div><div class="gridline" style="top:50%"></div>
        ${cols}
      </div>
      <div class="x-lbls">${labels}</div>
    </div>`;
  }

  return { render };
})();
