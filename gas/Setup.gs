/**
 * Setup.gs — run setup() ONCE from the Apps Script editor (Run ▶). It is safe to run again: it only creates what is
 * missing and never overwrites data rows. It creates the private spreadsheet, the Drive folders, the PIN pepper and
 * the starter content (edition 2026, closed until an admin sets the dates).
 *
 * Output goes to the Execution log: the spreadsheet URL and folder URLs. NEVER share the spreadsheet or the
 * team-files / backups folders with anyone except the admins.
 */

const SEED_SETTINGS = [
  ['site_name', 'Sci-Tech Pitching'],
  ['details_button_label', 'รายละเอียดโครงการ'],
  ['apply_button_label', 'สมัคร'],
  ['submit_label', 'Submit'],
  ['footer_text', '[PLACEHOLDER] หน่วยงานผู้จัด · อีเมลติดต่อ · เบอร์โทร'],
  ['contact_info', '[PLACEHOLDER] อีเมลคณะกรรมการ · เบอร์โทร'],
  ['gallery_intro', 'ภาพบรรยากาศการจัดงานของแต่ละปี'],
];

function setup() {
  const p = props_();

  let ss;
  if (p.getProperty('SHEET_ID')) {
    ss = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('SciTech Registration — DATA (private, do not share)');
    p.setProperty('SHEET_ID', ss.getId());
  }
  spreadsheetCache_ = ss;
  ensureSheets_(ss);

  const folders = ensureFolders_(p);

  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('ALLOWED_ORIGINS')) p.setProperty('ALLOWED_ORIGINS', 'http://localhost:5173,https://ncrmutr.github.io'); // origins that may upload (comma separated; see docs/OPERATIONS.md)

  const seeded = withLock_(seed_);

  const summary = {
    spreadsheetUrl: ss.getUrl(),
    folders: folders,
    seeded: seeded,
    nextStep: 'Deploy > Manage deployments > Edit > New version, then put the /exec URL in .env.local as VITE_GAS_URL',
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function ensureSheets_(ss) {
  const names = Object.keys(SCHEMA);
  names.forEach(function (name, idx) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      const first = ss.getSheets()[0];
      // The brand-new spreadsheet has one empty default sheet: reuse it for the first tab.
      sh = idx === 0 && ss.getSheets().length === 1 && first.getLastRow() === 0 ? first.setName(name) : ss.insertSheet(name);
    }
    const cols = SCHEMA[name];
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // text everywhere: no formulas, keeps leading zeros
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
}

function ensureFolders_(p) {
  const spec = [
    ['FOLDER_PUBLIC_ASSETS', 'public-assets', true],
    ['FOLDER_GALLERY', 'gallery', true],
    ['FOLDER_TEAM_FILES', 'team-files', false],
    ['FOLDER_BACKUPS', 'backups', false],
  ];
  let root;
  if (p.getProperty('FOLDER_ROOT')) {
    root = DriveApp.getFolderById(p.getProperty('FOLDER_ROOT'));
  } else {
    root = DriveApp.createFolder('SciTech Registration (files)');
    p.setProperty('FOLDER_ROOT', root.getId());
  }
  const out = { root: root.getUrl() };
  spec.forEach(function (s) {
    let folder;
    if (p.getProperty(s[0])) {
      folder = DriveApp.getFolderById(p.getProperty(s[0]));
    } else {
      folder = root.createFolder(s[1]);
      p.setProperty(s[0], folder.getId());
    }
    if (s[2]) {
      try {
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (err) {
        throw new Error('Cannot make folder "' + s[1] + '" public ("anyone with the link"): ' + err);
      }
    } else if (String(folder.getSharingAccess()) !== 'PRIVATE') {
      folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); // keep private folders private
    }
    out[s[1]] = { url: folder.getUrl(), sharing: String(folder.getSharingAccess()) };
  });
  return out;
}

/** Starter content (a starter set). Only fills empty sheets. Call inside withLock_(). */
function seed_() {
  const did = [];
  const now = nowIso_();
  if (rows_('site_settings').length === 0) {
    SEED_SETTINGS.forEach(function (kv) { append_('site_settings', { key: kv[0], value: kv[1], updated_at: now }); });
    did.push('site_settings');
  }
  if (rows_('editions').length === 0) {
    const editionId = uuid_();
    append_('editions', {
      id: editionId, year: 2026,
      title: 'Sci-Tech Pitching 2026',
      subtitle: 'การประกวดนำเสนอโครงงานวิทยาศาสตร์และเทคโนโลยี',
      intro_text: '[PLACEHOLDER] เปิดรับสมัครทีมนักศึกษาเพื่อเข้าร่วมเวทีนำเสนอแนวคิดและโครงงานต่อคณะกรรมการ ทีมละไม่เกิน 7 คน พร้อมอาจารย์ที่ปรึกษา นักศึกษา 1 คนสมัครได้ 1 ทีม',
      ack_text: 'ข้าพเจ้าได้อ่านรายละเอียดโครงการและเงื่อนไขการประกวดแล้ว และเข้าใจครบถ้วน',
      pdpa_text: '[PLACEHOLDER — ต้องให้ฝ่ายกฎหมาย/DPO ตรวจ] ข้าพเจ้ายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลของทีมเพื่อการคัดเลือก ติดต่อ และดำเนินการประกวดนี้เท่านั้น',
      key_dates: '[]', max_members: 7, reg_mode: 'closed', ref_prefix: 'ST26', ref_counter: 0,
      is_current: 'true', status: 'active', created_at: now,
    });
    [['เอกสารโครงงาน (ตัวอย่าง)', 'ไฟล์ PDF', 'pdf', 10, 1], ['ไฟล์เสริม (ตัวอย่าง)', 'ไม่บังคับ', 'pdf,jpg,jpeg,png', 5, 2]].forEach(function (s) {
      append_('upload_slots', { id: uuid_(), edition_id: editionId, title: s[0], description: s[1], accept: s[2], max_mb: s[3],
                                is_open: 'false', sort_order: s[4], created_at: now });
    });
    did.push('edition 2026 (closed) + 2 example upload slots');
  }
  return did;
}

/** Prints where everything is (run any time). */
function showSetup() {
  const p = props_();
  const out = {
    spreadsheet: p.getProperty('SHEET_ID') ? SpreadsheetApp.openById(p.getProperty('SHEET_ID')).getUrl() : 'not set up',
    pepperSet: !!p.getProperty('PEPPER'),
    allowedOrigins: p.getProperty('ALLOWED_ORIGINS'),
    folderRoot: p.getProperty('FOLDER_ROOT') ? DriveApp.getFolderById(p.getProperty('FOLDER_ROOT')).getUrl() : 'not set up',
  };
  console.log(JSON.stringify(out, null, 2));
  return out;
}
