// #/  Home: hero -> intro -> details (PDF modal) -> apply button + status -> key dates -> latest photos -> footer.
// Everything comes from the 'public_site' action (settings, current edition, latest photos, ready-to-use Drive URLs).
// Registration state is for display only; submit_team re-checks on the server.
import { h } from '../lib/dom.js';
import { loadSite, setting } from '../lib/site.js';
import { mountShell, renderLoadError } from '../lib/layout.js';
import { openModal } from '../lib/modal.js';
import { formatKeyDate, formatThaiDateTime } from '../lib/format.js';

function buildHero(site) {
  const ed = site.edition;
  const siteName = setting(site, 'site_name', 'Sci-Tech Pitching');
  const logoUrl = site.logo_url;
  const bgUrl = ed?.background_url;

  return h(
    'section',
    { class: 'hero', 'aria-label': 'ส่วนหัวเว็บ' },
    bgUrl ? h('img', { class: 'hero-bg', src: bgUrl, alt: '' }) : null,
    bgUrl ? h('div', { class: 'hero-shade' }) : null,
    h(
      'div',
      { class: 'hero-inner' },
      h('div', { class: 'hero-logo' }, logoUrl ? h('img', { src: logoUrl, alt: siteName }) : h('span', { 'aria-hidden': 'true' }, 'ST')),
      h('h1', ed?.title || siteName),
      ed?.subtitle ? h('div', { class: 'hero-sub' }, ed.subtitle) : null,
    ),
  );
}

function openRulesModal(site, trigger) {
  const ed = site.edition;
  const pdf = ed?.rules_pdf; // { preview_url, view_url, download_url } or null

  if (!pdf) {
    openModal({
      title: 'คำชี้แจงโครงการและรายละเอียดการประกวด',
      body: h('p', { class: 'empty-note' }, 'ยังไม่มีไฟล์รายละเอียดโครงการ โปรดกลับมาตรวจสอบอีกครั้งภายหลัง'),
    });
    return;
  }

  openModal({
    title: 'คำชี้แจงโครงการและรายละเอียดการประกวด',
    body: [
      h('iframe', { class: 'pdf-frame', src: pdf.preview_url, title: `${trigger}: ไฟล์ PDF` }),
      // Some mobile browsers cannot render a PDF inside an iframe — the buttons below always work.
      h('p', { class: 'hint' }, 'หากไม่เห็นเอกสารในกรอบนี้ (พบบนมือถือบางรุ่น) ให้กด "เปิดในแท็บใหม่" หรือ "ดาวน์โหลด PDF"'),
    ],
    actions: [
      h('a', { class: 'btn btn-outline', href: pdf.view_url, target: '_blank', rel: 'noopener' }, 'เปิดในแท็บใหม่'),
      h('a', { class: 'btn btn-primary', href: pdf.download_url, target: '_blank', rel: 'noopener' }, 'ดาวน์โหลด PDF'),
    ],
  });
}

function buildApplyBlock(site) {
  const ed = site.edition;
  const label = setting(site, 'apply_button_label', 'สมัคร');

  if (ed?.registration_open) {
    const closes = ed.registration_closes_at;
    const hasFutureEnd = closes && Date.parse(closes) > Date.parse(site.server_time);
    const status = hasFutureEnd ? `เปิดรับสมัครถึง ${formatThaiDateTime(closes)}` : 'เปิดรับสมัครแล้ว';
    return h(
      'div',
      { class: 'apply-box' },
      h('a', { class: 'btn btn-primary btn-lg', href: '#/apply' }, label),
      h('p', { class: 'reg-status reg-open' }, status),
    );
  }

  return h(
    'div',
    { class: 'apply-box' },
    h('button', { type: 'button', class: 'btn btn-disabled btn-lg', disabled: true, 'aria-disabled': 'true' }, label),
    h('p', { class: 'reg-status reg-closed' }, ed ? 'ปิดรับสมัครแล้ว' : 'ยังไม่มีรอบการจัดงานที่เปิดใช้งาน'),
  );
}

function buildDates(site) {
  const dates = Array.isArray(site.edition?.key_dates) ? site.edition.key_dates : [];
  return h(
    'section',
    { id: 'dates', class: 'section anchor', 'aria-labelledby': 'dates-title' },
    h('div', { class: 'section-head' }, h('h2', { id: 'dates-title' }, 'กำหนดการสำคัญ')),
    dates.length
      ? h(
          'ul',
          { class: 'dates' },
          dates.map((d) =>
            h('li', { class: 'date-card' }, h('div', { class: 'date-label' }, d?.label ?? ''), h('div', { class: 'date-value' }, formatKeyDate(d?.date))),
          ),
        )
      : h('p', { class: 'empty-note' }, 'จะประกาศกำหนดการเร็วๆ นี้'),
  );
}

function buildPhotos(photos) {
  if (!photos.length) return null; // hidden until an admin publishes an album
  return h(
    'section',
    { class: 'section', 'aria-labelledby': 'photos-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'photos-title' }, 'ภาพกิจกรรม'),
      h('a', { class: 'section-link', href: '#/gallery' }, 'ดูภาพทั้งหมด →'),
    ),
    h(
      'div',
      { class: 'photo-strip' },
      photos.map((p) =>
        h(
          'a',
          { href: '#/gallery', 'aria-label': p.caption || 'ภาพกิจกรรม' },
          h('img', { src: p.thumb_url, alt: p.caption || '', loading: 'lazy' }),
        ),
      ),
    ),
  );
}

export async function render(root) {
  let site;
  try {
    site = await loadSite();
  } catch (err) {
    renderLoadError(root, err, () => {
      root.replaceChildren(h('p', { class: 'boot' }, 'กำลังโหลด…'));
      render(root);
    });
    return;
  }

  const ed = site.edition;
  const siteName = setting(site, 'site_name', 'Sci-Tech Pitching');
  document.title = ed?.title ? `${ed.title} — ${siteName}` : siteName;

  const main = mountShell(root, { site, hero: buildHero(site) });
  const detailsLabel = setting(site, 'details_button_label', 'รายละเอียดโครงการ');

  main.append(
    h(
      'section',
      { class: 'intro', 'aria-label': 'แนะนำโครงการ' },
      ed?.intro_text ? h('p', { class: 'intro-text' }, ed.intro_text) : null,
      h('button', { type: 'button', class: 'btn btn-outline btn-lg', onClick: () => openRulesModal(site, detailsLabel) }, detailsLabel),
      buildApplyBlock(site),
    ),
    buildDates(site),
    buildPhotos(site.latest_photos ?? []),
  );

  // If the visitor arrived through the "กำหนดการ" menu link (#/dates), the router scrolls after render.
}
