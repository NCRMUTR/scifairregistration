// #/admin  Admin console: sign-in (ID + password) -> 7 tabs + account.
// Everything is checked on the server (Admin.gs): this file only shows or hides screens.
import { h } from '../lib/dom.js';
import { api, messageFor } from '../lib/api.js';
import { adminApi, hasSession, setSession, setOnExpired } from '../lib/adminApi.js';
import { notice, runBusy } from '../lib/ui.js';

const TABS = [
  { key: 'overview', label: 'ภาพรวม', load: () => import('./admin/overview.js') },
  { key: 'editions', label: 'ปี/รอบการจัด', load: () => import('./admin/editions.js') },
  { key: 'content', label: 'เนื้อหาหน้าเว็บ', load: () => import('./admin/content.js') },
  { key: 'teams', label: 'รายชื่อทีม', load: () => import('./admin/teams.js') },
  { key: 'slots', label: 'ช่องส่งไฟล์', load: () => import('./admin/slots.js') },
  { key: 'gallery', label: 'ภาพกิจกรรม', load: () => import('./admin/later.js').then((m) => ({ render: (c) => m.render(c, 'ภาพกิจกรรม', 'Stage G5') })) },
  { key: 'backup', label: 'สำรอง/รีเซ็ต', load: () => import('./admin/later.js').then((m) => ({ render: (c) => m.render(c, 'สำรอง/รีเซ็ตข้อมูล', 'Stage G6') })) },
  { key: 'account', label: 'บัญชีของฉัน', load: () => import('./admin/account.js') },
];

export async function render(root) {
  document.title = 'Admin — Sci-Tech Pitching';
  let robots = document.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = h('meta', { name: 'robots', content: 'noindex' });
    document.head.append(robots);
  }
  let alive = true;
  let loadToken = 0;

  setOnExpired(() => {
    if (alive) showLogin('เซสชันหมดอายุ โปรดเข้าสู่ระบบใหม่');
  });

  // ───────────── sign-in ─────────────
  function showLogin(message = '') {
    const note = notice();
    if (message) note.show('warn', message);
    const idInput = h('input', { class: 'inp', id: 'ad-id', type: 'text', autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false' });
    const pwInput = h('input', { class: 'inp', id: 'ad-pw', type: 'password', autocomplete: 'current-password' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, 'เข้าสู่ระบบ');
    const form = h(
      'form',
      { class: 'login-card', novalidate: true },
      h('div', { class: 'slip-small' }, 'Sci-Tech Pitching'),
      h('h1', 'เข้าสู่ระบบ Admin'),
      h('div', { class: 'field' }, h('label', { for: 'ad-id' }, 'ID'), idInput),
      h('div', { class: 'field' }, h('label', { for: 'ad-pw' }, 'รหัสผ่าน'), pwInput),
      note.el,
      submit,
      h('a', { class: 'back-link', href: '#/' }, '← กลับหน้าหลัก'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!idInput.value.trim() || !pwInput.value) return note.show('err', 'กรอก ID และรหัสผ่าน');
      await runBusy(
        submit,
        'กำลังตรวจสอบ…',
        async () => {
          try {
            const data = await api('admin_login', { id: idInput.value, password: pwInput.value });
            setSession(data.session);
            pwInput.value = '';
            showConsole(data);
          } catch (err) {
            pwInput.value = '';
            pwInput.focus();
            if (err.reason === 'admin_invalid' && typeof err.extra?.attempts_left === 'number') {
              note.show('err', `${messageFor(err)} (เหลืออีก ${err.extra.attempts_left} ครั้งก่อนล็อกชั่วคราว)`);
            } else {
              note.error(err);
            }
          }
        },
        note,
      );
    });
    root.replaceChildren(h('main', { class: 'login-page', id: 'main' }, form));
    idInput.focus();
  }

  // ───────────── console ─────────────
  function showConsole(me) {
    const yearBadge = h('span', { class: 'year-pill', hidden: true });
    const panel = h('div', { class: 'admin-panel', tabindex: '-1' });
    const tabBar = h('div', { class: 'admin-tabs', role: 'tablist', 'aria-label': 'เมนู Admin' });
    let active = '';

    const ctx = {
      me,
      call: adminApi,
      setYear(year) {
        yearBadge.textContent = `ปีที่กำลังจัด: ${year}`;
        yearBadge.hidden = !year;
      },
      go: (key) => openTab(key),
    };

    const buttons = TABS.map((t) => {
      const b = h('button', { type: 'button', role: 'tab', class: 'admin-tab', 'aria-selected': 'false', id: `tab-${t.key}`, onClick: () => openTab(t.key) }, t.label);
      tabBar.append(b);
      return b;
    });

    async function openTab(key) {
      const tab = TABS.find((t) => t.key === key) ?? TABS[0];
      const token = ++loadToken;
      active = tab.key;
      TABS.forEach((t, i) => {
        buttons[i].setAttribute('aria-selected', String(t.key === active));
        buttons[i].classList.toggle('is-active', t.key === active);
      });
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `tab-${tab.key}`);
      panel.replaceChildren(h('p', { class: 'boot' }, 'กำลังโหลด…'));
      try {
        const mod = await tab.load();
        if (token !== loadToken) return;
        const body = h('div', { class: 'admin-body' });
        panel.replaceChildren(body);
        await mod.render(body, ctx);
      } catch (err) {
        if (token !== loadToken || err.reason === 'unauthorized') return;
        console.error(err);
        panel.replaceChildren(
          h(
            'div',
            { class: 'banner-err', role: 'alert' },
            messageFor(err),
            ' ',
            h('button', { type: 'button', class: 'btn btn-outline btn-sm', onClick: () => openTab(tab.key) }, 'ลองอีกครั้ง'),
          ),
        );
      }
    }

    const logout = h('button', { type: 'button', class: 'btn btn-on-dark' }, 'ออกจากระบบ');
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        await adminApi('admin_logout');
      } catch {
        /* the session is dropped locally either way */
      }
      setSession(null);
      showLogin();
    });

    root.replaceChildren(
      h(
        'div',
        { class: 'admin-page' },
        h(
          'header',
          { class: 'admin-top on-dark' },
          h('strong', 'Admin · Sci-Tech Pitching'),
          h('div', { class: 'admin-top-right' }, yearBadge, h('span', { class: 'admin-user' }, me.id), logout),
        ),
        h('div', { class: 'admin-tabs-wrap' }, tabBar),
        h('main', { id: 'main', class: 'admin-main' }, panel),
      ),
    );
    openTab('overview');
  }

  // ───────────── start ─────────────
  if (hasSession()) {
    root.replaceChildren(h('p', { class: 'boot' }, 'กำลังตรวจสอบการเข้าสู่ระบบ…'));
    try {
      showConsole({ ...(await adminApi('admin_me')) });
    } catch {
      if (!document.getElementById('ad-id')) showLogin();
    }
  } else {
    showLogin();
  }

  return () => {
    alive = false;
    loadToken++;
    setOnExpired(() => {});
  };
}
