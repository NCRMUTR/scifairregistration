// Test double of the Apps Script services (Sheets, Cache, Lock, Properties, Drive, UrlFetch, a controllable clock) that runs
// the REAL gas/*.gs files, so the business rules can be tested offline: `npm test`.
const fs = require('fs'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');
const root = require('path').join(__dirname, '..', '..', 'gas') + '/';
const code = ['Db.gs', 'Code.gs', 'Public.gs', 'Apply.gs', 'Team.gs', 'Admin.gs', 'AdminData.gs', 'Gallery.gs', 'Backup.gs', 'Documents.gs'].map((f) => fs.readFileSync(root + f, 'utf8')).join('\n');

const store = {}; // sheet name -> 2D array (row 0 = header)
const props = { SHEET_ID: 'x', PEPPER: 'pepper-pepper', ALLOWED_ORIGINS: 'http://localhost:5173,https://ncrmutr.github.io', FOLDER_TEAM_FILES: 'TEAMFILES', FOLDER_BACKUPS: 'BACKUPS', SHEET_ID_FILE: '', FOLDER_GALLERY: 'GALLERYFOLDER', FOLDER_PUBLIC_ASSETS: 'PUBFOLDER' };
global.__n = 0;
const driveFiles = {}; // id -> { name, parent, size, mime, trashed }
const cacheStore = {};
function mkSheet(name) {
  const get = () => store[name];
  return {
    getLastRow: () => get().length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) row.push((get()[r - 1 + i] || [])[c - 1 + j] ?? '');
            out.push(row);
          }
          return out;
        },
        setValues: (vals) => {
          vals.forEach((rv, i) => {
            get()[r - 1 + i] = get()[r - 1 + i] || [];
            rv.forEach((v, j) => { get()[r - 1 + i][c - 1 + j] = String(v); });
          });
        },
        setNumberFormat() {},
        clearContent() {
          for (let i = 0; i < nr; i++) get()[r - 1 + i] = undefined;
          store[name] = get().filter((x) => x !== undefined);
        },
      };
    },
    deleteRow: (n) => get().splice(n - 1, 1),
  };
}

const driveFolders = {}; // id -> { name, parent, deleted }
const failDelete = new Set();
const mkBlob = (buf, name, type) => ({ _buf: buf, getBytes: () => [...buf], getName: () => name, setName(n) { name = n; return this; }, getContentType: () => type });
const mkFolder = (id) => {
  if (!driveFolders[id]) driveFolders[id] = { name: id, parent: null };
  return {
    getId: () => id, getUrl: () => 'https://drive.example/folders/' + id,
    createFolder: (name) => { const nid = 'FOLDER' + String(++global.__n).padStart(6, '0'); driveFolders[nid] = { name, parent: id }; return mkFolder(nid); },
    createFile: (blob) => { const nid = 'CFILE' + String(++global.__n).padStart(7, '0'); driveFiles[nid] = { name: blob.getName(), parent: id, size: blob._buf.length, mime: blob.getContentType(), buf: blob._buf, entries: blob._entries }; return mkFile(nid); },
    getFoldersByName: (name) => { const hits = Object.entries(driveFolders).filter(([k, f]) => f.parent === id && f.name === name && !f.deleted).map(([k]) => k); let i = 0; return { hasNext: () => i < hits.length, next: () => mkFolder(hits[i++]) }; },
  };
};
const mkFile = (id) => {
  const f = driveFiles[id];
  if (!f || f.deleted) throw new Error('no file');
  return {
    getId: () => id,
    getParents: () => { let d = false; return { hasNext: () => !d, next: () => { d = true; return { getId: () => f.parent }; } }; },
    getName: () => f.name, getSize: () => f.size, getMimeType: () => f.mime, setTrashed: (t) => { f.trashed = t; },
    getBlob: () => { if (f.trashed) { /* trashed files are still readable in Drive */ } return mkBlob(f.buf || Buffer.alloc(f.size, 7), f.name, f.mime); },
    makeCopy: (name, folder) => { const nid = 'COPY' + String(++global.__n).padStart(7, '0'); driveFiles[nid] = { name, parent: folder.getId(), size: 1, mime: 'application/vnd.google-apps.spreadsheet' }; return mkFile(nid); },
  };
};
let clockOffset = 0;
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(Date.now() + clockOffset); }
  static now() { return Date.now() + clockOffset; }
}
FakeDate.now = () => Date.now() + clockOffset;
const setClock = (ms) => { clockOffset = ms; };
const advance = (ms) => { clockOffset += ms; };
const ctx = {
  console, Date: FakeDate, JSON, Math, parseInt, isFinite, Number, String, Object, Array, RegExp, Error,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => (props[k] = v), deleteProperty: (k) => delete props[k] }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => (store[n] ? mkSheet(n) : null) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore[k] ?? null, put: (k, v) => (cacheStore[k] = v), remove: (k) => delete cacheStore[k], removeAll: (ks) => ks.forEach((k) => delete cacheStore[k]) }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    computeHmacSha256Signature: (v, k) => [...crypto.createHmac('sha256', k).update(v).digest()].map((b) => (b > 127 ? b - 256 : b)),
    computeDigest: (a, v) => [...crypto.createHash('md5').update(v).digest()].map((b) => (b > 127 ? b - 256 : b)),
    computeHmacSignature: (alg, msg, key) => [...crypto.createHmac('sha1', Buffer.from(key.map((b) => b & 255))).update(Buffer.from(msg.map((b) => b & 255))).digest()].map((b) => (b > 127 ? b - 256 : b)),
    MacAlgorithm: { HMAC_SHA_1: 1 },
    DigestAlgorithm: { MD5: 1 }, Charset: { UTF_8: 1 },
    newBlob: (data, type, name) => mkBlob(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'), name, type),
    zip: (blobs, name) => { const o = mkBlob(Buffer.concat(blobs.map((b) => b._buf)), name, 'application/zip'); o._entries = blobs.map((b) => b.getName()); return o; },
  },
  DriveApp: {
    getFolderById: (id) => mkFolder(id),
    getFileById: (id) => mkFile(id),
  },
  UrlFetchApp: {
    fetch: (url, o) => { const pl = JSON.parse(o.payload); const id = 'MOCKFILE' + String(++global.__n).padStart(6, '0'); driveFiles[id] = { name: pl.name, parent: pl.parents[0], size: Number(o.headers['X-Upload-Content-Length']), mime: o.headers['X-Upload-Content-Type'] }; return { getResponseCode: () => 200, getAllHeaders: () => ({ Location: 'https://upload.example/session/' + id }), getContentText: () => '' }; },
    fetchAll: (reqs) => reqs.map((r) => {
      if (r.method !== 'delete') throw new Error('unexpected fetchAll ' + r.method);
      const id = decodeURIComponent(/files\/([^?]+)/.exec(r.url)[1]);
      let code = 404;
      if (failDelete.has(id)) code = 403;
      else if (driveFiles[id] && !driveFiles[id].deleted) { driveFiles[id].deleted = true; code = 204; }
      else if (driveFolders[id] && !driveFolders[id].deleted) { driveFolders[id].deleted = true; Object.values(driveFiles).forEach((f) => { if (f.parent === id) f.deleted = true; }); code = 204; }
      return { getResponseCode: () => code };
    }),
  },
  ScriptApp: { getOAuthToken: () => 'tok' },
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
};
vm.createContext(ctx);
vm.runInContext(code + '\nthis.__x = { SCHEMA, ACTIONS, doPost, base32Encode_, base32Decode_, totpCode_, createAdmin, totpVerify_, withLock_ };', ctx);
const { SCHEMA, ACTIONS, doPost } = ctx.__x;
Object.keys(SCHEMA).forEach((n) => (store[n] = [SCHEMA[n].slice()]));


const row = (n, o) => store[n].push(SCHEMA[n].map((c) => String(o[c] ?? '')));
const call = (a, r) => {
  try { return { ok: true, data: ACTIONS[a](r) }; } catch (e) { if (!e.reason) throw e; return { ok: false, reason: e.reason, extra: e.extra }; }
};
module.exports = { clock: () => clockOffset, setClock, advance, driveFolders, failDelete, driveFiles, ctx, store, props, cacheStore, SCHEMA, ACTIONS, doPost, row, call, fns: ctx.__x, crypto };
