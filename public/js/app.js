'use strict';

/** Router + shell: hash-based navigation, nav bars, session handling. */
const App = (() => {
  const ROUTES = {
    dashboard: { label: 'תמונת מצב', icon: '📊', view: () => DashboardView, nav: true },
    flock: { label: 'ספר עדר', icon: '🐑', view: () => FlockView, nav: true },
    lambings: { label: 'המלטות', icon: '🍼', view: () => LambingsView, nav: true },
    planning: { label: 'תכנון', icon: '📅', view: () => PlanningView, nav: true },
    health: { label: 'טיפול רפואי', icon: '⚕️', view: () => HealthView, nav: true },
    feed: { label: 'מזון', icon: '🌾', view: () => FeedView, nav: true },
    sales: { label: 'מכירות', icon: '💰', view: () => SalesView, nav: true },
    purchases: { label: 'קניה', icon: '🛒', view: () => PurchasesView, nav: true },
    finance: { label: 'כלכלי', icon: '📈', view: () => FinanceView, nav: true },
    animal: { label: 'כרטיס חיה', icon: '🐑', view: () => AnimalView, nav: false },
    users: { label: 'משתמשים', icon: '👥', view: () => UsersView, nav: false },
  };

  let user = null;
  let current = 'dashboard';

  function canWrite() {
    return user && user.role !== 'viewer';
  }

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [route, query] = raw.split('?');
    const params = {};
    new URLSearchParams(query || '').forEach((v, k) => { params[k] = v; });
    return { route: ROUTES[route] ? route : 'dashboard', params };
  }

  function go(route, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const target = `#/${route}${qs ? `?${qs}` : ''}`;
    if (location.hash === target) handleRoute();
    else location.hash = target;
  }

  async function handleRoute() {
    const { route, params } = parseHash();
    current = route;
    paintNav();
    const main = document.getElementById('main');
    window.scrollTo(0, 0);
    try {
      await ROUTES[route].view().render(main, params);
    } catch (err) {
      main.innerHTML = `<div class="card"><div class="empty">
        <div class="ico">⚠️</div>${UI.esc(err.message)}
        <div style="margin-top:12px"><button class="btn btn-ghost btn-sm" onclick="location.reload()">רענון</button></div>
      </div></div>`;
    }
  }

  function paintNav() {
    const items = Object.entries(ROUTES).filter(([, r]) => r.nav);
    const active = r => (r === current || (current === 'animal' && r === 'flock')) ? 'active' : '';

    document.getElementById('topnav').innerHTML = items
      .map(([k, r]) => `<button class="${active(k)}" data-route="${k}">${UI.esc(r.label)}</button>`).join('');
    document.getElementById('bottomnav').innerHTML = items
      .map(([k, r]) => `<button class="${active(k)}" data-route="${k}"><span style="font-size:17px">${r.icon}</span>${UI.esc(r.label)}</button>`).join('');

    document.querySelectorAll('[data-route]').forEach(b =>
      b.addEventListener('click', () => go(b.dataset.route)));
  }

  function wireUserMenu() {
    const pop = document.getElementById('user-pop');
    const avatar = document.getElementById('avatar');
    avatar.textContent = (user.name || user.username).trim().charAt(0);
    document.getElementById('who').textContent =
      `${user.name || user.username} · ${user.role === 'admin' ? 'מנהל מערכת' : user.role === 'manager' ? 'מנהל חווה' : 'צפייה בלבד'}`;

    if (user.role !== 'admin') document.getElementById('users-link').classList.add('hidden');
    else document.getElementById('users-link').addEventListener('click', () => { pop.classList.add('hidden'); go('users'); });

    avatar.addEventListener('click', ev => { ev.stopPropagation(); pop.classList.toggle('hidden'); });
    document.addEventListener('click', () => pop.classList.add('hidden'));
    pop.addEventListener('click', ev => ev.stopPropagation());

    document.getElementById('logout').addEventListener('click', async () => {
      await API.post('/api/auth/logout');
      location.href = '/login';
    });

    document.getElementById('change-pw').addEventListener('click', () => {
      pop.classList.add('hidden');
      UI.openModal({
        title: 'שינוי סיסמה',
        submitLabel: 'עדכון',
        body: `<div class="form-grid">
          ${UI.field('currentPassword', 'סיסמה נוכחית', { type: 'password', required: true, cls: 'full' })}
          ${UI.field('newPassword', 'סיסמה חדשה', { type: 'password', required: true, cls: 'full', hint: '6 תווים לפחות' })}
        </div>`,
        onSubmit: async form => {
          await API.post('/api/auth/password', UI.formData(form));
          UI.toast('הסיסמה עודכנה');
        },
      });
    });

    document.querySelector('.brand').addEventListener('click', () => go('dashboard'));
  }

  async function boot() {
    try {
      const me = await API.get('/api/auth/me');
      user = me.user;
    } catch (_) {
      location.href = '/login';
      return;
    }
    App.user = user;
    wireUserMenu();
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  const self = { go, canWrite, boot, get user() { return user; }, set user(u) { user = u; } };
  return self;
})();

document.addEventListener('DOMContentLoaded', App.boot);
