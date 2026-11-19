/**
 * 청소용품 요청 — 구글 스프레드시트 Apps Script (서버 역할)
 *
 * 흐름
 *   휴대폰 앱(index.html) → 이 스크립트(웹 앱) → '청소용품' 시트 한 줄
 *   품명 바로 옆 칸에 쿠팡 링크가 자동으로 붙는다.
 *     · 쿠팡 상품 주소를 같이 넣으면 그 상품 링크
 *     · 안 넣으면 '쿠팡에서 품명 검색' 링크
 *   시트에서 직접 품명을 적어도(onEdit) 똑같이 링크·ID·등록일시가 채워진다.
 *
 * 설치: README.md — 휴대폰만으로 된다.
 *   script.google.com 새 프로젝트에 이 파일만 붙여넣고 웹 앱으로 배포 → 앱의 '처음 설치' 화면에 주소를 넣으면
 *   init 이 시트('청소용품 요청')를 만들고 팀 코드를 정해서 돌려준다. 시트 메뉴는 필요 없다.
 *   (시트에 붙여서 쓰는 옛 방식 — 확장 프로그램 → Apps Script — 도 그대로 된다)
 * 검증: node test/test.js   (아래 함수들을 가짜 시트로 돌린다)
 */

// 서버 코드 버전 — 고칠 때마다 올린다. 브라우저로 <웹 앱 주소>?action=version 을 열면 팀 코드 없이 이 값이 보인다.
// 앱(index.html)의 SERVER_LATEST 와 같으면 최신.
const SERVER_VERSION = '2026-11-19'; // 메모 한꺼번에 등록(addMany) · 물품팩(packs/savePack/removePack, '물품팩' 탭)

const CFG = {
  SHEET: '청소용품',
  // 앱 주소 (GitHub Pages). 비워두면 '연결 링크'를 웹 앱 주소로만 만든다.
  PAGE_URL: 'https://endia4644.github.io/request/',
  // Apps Script 주소로 열었을 때 보여줄 화면 (index.html 파일을 따로 안 넣어도 되게 여기서 받아 온다)
  RAW_INDEX: 'https://raw.githubusercontent.com/endia4644/request/main/index.html',
  SS_NAME: '청소용품 요청',
  TZ: 'Asia/Seoul',
  KEEP_DONE_DAYS: 90,   // 입고완료는 이 일수 지난 것은 앱 목록에서 뺀다 (시트에는 남음)
};

// 열은 이름으로 맞춘다: 옛 시트(9열·11열)에 없는 열은 migrate_ 가 제자리에 끼운다.
// 2026-11-16 수취인·연락처 → 같은 날 사진(쿠팡 대표 이미지)·주소 추가
const HEAD = ['등록일시', '현장', '품명', '쿠팡', '사진', '수량', '수취인', '연락처', '주소', '등록자', '상태', '메모', 'ID'];
const COL = { TIME: 1, SITE: 2, NAME: 3, LINK: 4, IMG: 5, QTY: 6, RCV: 7, TEL: 8, ADDR: 9, BY: 10, STATUS: 11, MEMO: 12, ID: 13 };
// 현장별 수취인 목록 (개인정보라 이 시트에만 둔다 — 공개 저장소에는 넣지 않는다)
// 구분 = 발주서 엑셀의 묶음 이름(예: 무신사 스탠다드). 열 순서는 머리 이름으로 찾으므로 바뀌어도 된다.
const CONTACT_SHEET = '수취인';
const CONTACT_HEAD = ['구분', '현장', '이름', '전화번호', '주소'];
const STATUSES = ['요청', '주문완료', '입고완료'];
const PACK_SHEET = '물품팩'; // 자주 시키는 물건 묶음 (예: 신규현장 물품팩). 한 줄 = 팩 이름|품목|수량|쿠팡 링크
const PACK_HEAD = ['팩 이름', '품목', '수량', '쿠팡 링크'];
const PACK_MAX = { packs: 30, items: 80, bulk: 100 };
const LIMIT = { name: 80, site: 40, qty: 20, by: 20, memo: 300, link: 500, rcv: 20, tel: 20, addr: 120 };

const COLOR = {
  head: '#1f2937', headInk: '#ffffff', line: '#e5e7eb',
  req: '#fff4cc', reqInk: '#8a6100',
  ord: '#e8f0fe', ordInk: '#1a56db',
  done: '#f3f4f6', doneInk: '#9ca3af',
};

// ═════════════════════════════════════════════════════════════
// 웹 앱 입구
// ═════════════════════════════════════════════════════════════

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.action) {
    // 주소만 열면 앱 화면 자체를 보여준다 (GitHub Pages 없이도 쓸 수 있게)
    return appHtml_()
      .setTitle('청소용품')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
  return json_(handle_(p));
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: '요청 형식이 잘못됐습니다' });
  }
  return json_(handle_(req));
}

/** 앱이 Apps Script 주소로 열렸을 때 google.script.run 으로 부르는 입구 */
function api(reqText) {
  let req;
  try { req = JSON.parse(reqText || '{}'); } catch (err) { return JSON.stringify({ ok: false, error: '요청 형식이 잘못됐습니다' }); }
  return JSON.stringify(handle_(req));
}

/** 프로젝트에 index 파일이 있으면 그걸, 없으면 GitHub에서 받아 온 화면 (1시간 캐시) */
function appHtml_() {
  try { return HtmlService.createHtmlOutputFromFile('index'); } catch (err) { /* 파일 없음 */ }
  const cache = CacheService.getScriptCache();
  let html = cache.get('index');
  if (!html) {
    html = UrlFetchApp.fetch(CFG.RAW_INDEX).getContentText();
    try { cache.put('index', html, 3600); } catch (err) { /* 100KB 넘으면 캐시 없이 */ }
  }
  return HtmlService.createHtmlOutput(html);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  try {
    if (req.action === 'version') return { ok: true, version: SERVER_VERSION }; // 팀 코드 없이 (배포 확인용)
    if (req.action === 'init') return withLock_(() => init_(req));
    const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
    if (!key) return { ok: false, error: '아직 설치가 안 끝났어요. 앱의 [처음 설치] 화면에서 이 주소를 넣어주세요', code: 'NOINIT' };
    if (String(req.k || '') !== key) return { ok: false, error: '팀 코드가 맞지 않습니다', code: 'KEY' };

    switch (req.action) {
      case 'info': return { ok: true, sheetUrl: ss_().getUrl() };
      case 'list': {
        const r = listItems_(String(req.all || '') === '1');
        r.version = SERVER_VERSION;
        if (String(req.contacts || '') === '1') r.contacts = readContacts_();
        return r;
      }
      case 'add': return withLock_(() => addItem_(req));
      case 'update': return withLock_(() => updateItem_(req));
      case 'remove': return withLock_(() => removeItem_(req));
      case 'thumb': return thumbItem_(req);
      case 'importContacts': return withLock_(() => importContacts_(req));
      case 'addMany': return withLock_(() => addMany_(req));
      case 'packs': return { ok: true, packs: readPacks_() };
      case 'savePack': return withLock_(() => savePack_(req));
      case 'removePack': return withLock_(() => removePack_(req));
      default: return { ok: false, error: '알 수 없는 요청: ' + req.action };
    }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

// ═════════════════════════════════════════════════════════════
// 읽기 / 쓰기
// ═════════════════════════════════════════════════════════════

/**
 * 처음 설치: 시트를 만들고 팀 코드를 정해 돌려준다. 한 번만 된다.
 * (배포 직후 주소를 아는 사람은 설치한 본인뿐이다. 이미 설치됐으면 팀 코드를 아는 경우에만 시트 주소를 알려준다)
 */
function init_(req) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('TEAM_KEY');
  if (key) {
    if (String(req.k || '') === key) return { ok: true, k: key, sheetUrl: ss_().getUrl(), again: true };
    return { ok: false, error: '이미 설치된 주소예요. 관리자에게 연결 링크를 받아주세요', code: 'INIT_DONE' };
  }
  sheet_();
  const k = makeKey_();
  props.setProperty('TEAM_KEY', k);
  return { ok: true, k, sheetUrl: ss_().getUrl() };
}

/**
 * 데이터 시트가 있는 스프레드시트.
 *  · 시트에 붙은 스크립트면 그 시트
 *  · 따로 만든 스크립트(휴대폰 설치)면 처음 한 번 '청소용품 요청' 스프레드시트를 내 드라이브에 만든다
 */
function ss_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create(CFG.SS_NAME);
  ss.setSpreadsheetTimeZone(CFG.TZ);
  const first = ss.getSheets()[0];
  first.setName(CFG.SHEET);
  formatSheet_(first);
  props.setProperty('SHEET_ID', ss.getId());
  // 따로 만든 스크립트에는 onEdit 가 저절로 안 붙는다 → 설치형 트리거로 단다
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  return ss;
}

function sheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CFG.SHEET);
  if (!sh) {
    sh = ss.insertSheet(CFG.SHEET);
    formatSheet_(sh);
  }
  migrate_(sh);
  relabelLinks_(sh);
  return sh;
}

/**
 * 옛 시트에 없는 열(사진·수취인·연락처·주소)을 HEAD 순서대로 제자리에 끼운다. 이미 맞으면 아무것도 안 한다.
 * 머리 이름으로 비교하므로 9열·11열 어느 옛 모양이든 된다.
 */
function migrate_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map((v) => String(v).trim());
  if (!head[0]) return;
  let changed = false;
  for (let i = 1; i < HEAD.length; i++) {
    if (head[i] === HEAD[i] || head.indexOf(HEAD[i]) >= 0) continue;
    sh.insertColumnsAfter(i, 1);
    head.splice(i, 0, HEAD[i]);
    changed = true;
  }
  if (changed) formatSheet_(sh);
}

// ── 수취인 목록 ────────────────────────────────────────────────
function contactSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CONTACT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONTACT_SHEET);
    sh.getRange(1, 1, 1, CONTACT_HEAD.length).setValues([CONTACT_HEAD])
      .setFontWeight('bold').setBackground(COLOR.head).setFontColor(COLOR.headInk).setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    [130, 170, 90, 130, 320].forEach((w, i) => sh.setColumnWidth(i + 1, w));
    sh.getRange('D2:D').setNumberFormat('@');
  }
  return sh;
}

/** 수취인 탭의 열 위치(1부터)를 머리 이름으로 찾는다. 없는 열은 맨 뒤에 머리를 단다. */
function contactCols_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map((v) => String(v).trim());
  const col = {};
  CONTACT_HEAD.forEach((h) => {
    let i = head.indexOf(h);
    if (i < 0 && h === '전화번호') i = head.indexOf('연락처');
    if (i < 0 && h === '이름') i = head.indexOf('성명');
    if (i < 0) { head.push(h); i = head.length - 1; sh.getRange(1, i + 1).setValue(h); }
    col[h] = i + 1;
  });
  col.width = head.length;
  return col;
}

// 팀 칸이 근무 형태면 현장 이름에 붙이지 않는다 (오션: 부서 + 팀 = 현장)
const NONLOC_TEAM = ['-', '', '시설팀', '평일', '주말', '상주'];

/** 오션 부서·팀 → 현장 이름. 팀이 근무 형태(평일·주말·…)거나 부서와 같으면 부서만 */
function siteOf(dept, team) {
  dept = String(dept || '').trim(); team = String(team || '').trim();
  if (!dept || dept === '-') return '본사·관리';
  if (NONLOC_TEAM.indexOf(team) >= 0 || team === dept || dept.slice(-team.length - 1) === ' ' + team) return dept;
  return dept + ' ' + team;
}

/**
 * 머리 줄에서 근무자 명단 열 위치를 찾는다. 이름(성명) + 현장(부서)이 없으면 null.
 * 같은 뜻의 열이 여러 개면(예: 오션 원본 '성명'·'전화번호' 옆에 빈 '이름'·'전화번호' 열이 또 붙은 경우)
 * 아래 줄들(data)에 값이 가장 많이 든 열을 고른다. (2026-11-16 사용자 시트가 실제로 이랬다)
 */
function contactHeader_(row, data) {
  const h = row.map((v) => String(v == null ? '' : v).replace(/\s/g, ''));
  const filled = (i) => {
    let n = 0;
    for (let r = 0; r < data.length; r++) if (String(data[r][i] == null ? '' : data[r][i]).trim() !== '') n++;
    return n;
  };
  const pick = (...names) => {
    let best = -1, bestN = -1;
    h.forEach((x, i) => {
      if (names.indexOf(x) < 0) return;
      const n = filled(i);
      if (n > bestN) { best = i; bestN = n; }
    });
    return best;
  };
  const m = {
    name: pick('이름', '성명', '성함'), site: pick('현장', '현장명'), dept: pick('부서'), team: pick('팀'),
    grp: pick('구분'), tel: pick('전화번호', '연락처', '휴대폰', '휴대전화', '핸드폰'), addr: pick('주소'),
  };
  if (m.name < 0 || (m.site < 0 && m.dept < 0)) return null;
  return m;
}

/**
 * 근무자 명단 읽기: '수취인' 탭 먼저, 그다음 다른 탭 중 명단처럼 생긴 것(머리 줄에 이름/성명 + 현장/부서)도 읽는다.
 * 사용자가 명단을 다른 이름의 탭(예: 오션에서 받은 그대로)에 넣어도 되게. 같은 현장·이름은 처음 것만.
 */
function readContacts_() {
  contactSheet_(); // 없으면 만들어 둔다 (새 수취인을 적을 자리)
  const ss = ss_();
  const sheets = ss.getSheets().filter((sh) => sh.getName() !== CFG.SHEET && sh.getName() !== PACK_SHEET)
    .sort((a, b) => (b.getName() === CONTACT_SHEET) - (a.getName() === CONTACT_SHEET));
  const out = [];
  const seen = {};
  sheets.forEach((sh) => {
    const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 2) return;
    const vals = sh.getRange(1, 1, Math.min(lastRow, 5000), Math.min(lastCol, 40)).getValues();
    let hi = -1, m = null;
    for (let i = 0; i < Math.min(5, vals.length); i++) { m = contactHeader_(vals[i], vals.slice(i + 1, i + 301)); if (m) { hi = i; break; } }
    if (!m) return;
    const get = (r, k) => (m[k] >= 0 ? String(r[m[k]] == null ? '' : r[m[k]]).trim() : '');
    for (let i = hi + 1; i < vals.length; i++) {
      const r = vals[i];
      const name = get(r, 'name');
      if (!name) continue;
      const dept = get(r, 'dept'), team = get(r, 'team');
      let site = get(r, 'site');
      if (!site) site = siteOf(dept, team);
      const key = site + '|' + name;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({ grp: get(r, 'grp') || (dept && dept !== '-' ? dept : ''), site, name, tel: normalizePhone(m.tel >= 0 ? r[m.tel] : ''), addr: get(r, 'addr') });
    }
  });
  return out;
}

/**
 * 앱에서 올린 근무자 명단으로 수취인 탭을 통째로 바꾼다 (다른 탭은 건드리지 않는다).
 * rows: [{grp, dept, site, name, tel, addr}] — 이미 적혀 있던 주소·구분은 같은 현장·이름이면 살린다.
 */
function importContacts_(req) {
  const rows = Array.isArray(req.rows) ? req.rows.slice(0, 3000) : [];
  const clean = rows.map((r) => ({
    grp: clip_(r.grp, 40), dept: clip_(r.dept, 40), site: clip_(r.site, LIMIT.site), name: clip_(r.name, LIMIT.rcv),
    tel: normalizePhone(clip_(r.tel, LIMIT.tel)), addr: clip_(r.addr, LIMIT.addr),
  })).filter((r) => r.name);
  if (!clean.length) return { ok: false, error: '명단에 이름이 하나도 없어요' };
  const old = {};
  const oldGrp = {};
  readContacts_().forEach((c) => { old[c.site + '|' + c.name] = c; if (c.grp) oldGrp[c.site] = c.grp; });
  const sh = contactSheet_();
  const last = sh.getLastRow();
  const width = Math.max(sh.getLastColumn(), CONTACT_HEAD.length);
  if (last >= 2) sh.getRange(2, 1, last - 1, width).clearContent();
  sh.getRange(1, 1, 1, width).clearContent();
  sh.getRange(1, 1, 1, CONTACT_HEAD.length).setValues([CONTACT_HEAD]);
  sh.getRange('D2:D').setNumberFormat('@');
  const out = clean.map((r) => {
    const o = old[r.site + '|' + r.name] || {};
    // 구분: 파일의 구분 열 → 시트에 있던 구분 → 부서 이름 (오션 원본엔 구분 열이 없다)
    return [safeText(r.grp || oldGrp[r.site] || r.dept || ''), safeText(r.site), safeText(r.name), safeText(r.tel || o.tel || ''), safeText(r.addr || o.addr || '')];
  });
  sh.getRange(2, 1, out.length, CONTACT_HEAD.length).setValues(out);
  return { ok: true, count: out.length, sites: Object.keys(clean.reduce((m, r) => { m[r.site] = 1; return m; }, {})).length };
}

/** 등록할 때 쓴 수취인을 목록에 더한다 (같은 현장·이름이면 비어 있거나 바뀐 전화번호·주소만 고침) */
function upsertContact_(site, name, tel, addr) {
  if (!name) return;
  const sh = contactSheet_();
  const col = contactCols_(sh);
  const last = sh.getLastRow();
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, col.width).getValues() : [];
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][col['현장'] - 1]).trim() === site && String(rows[i][col['이름'] - 1]).trim() === name) {
      if (tel && normalizePhone(rows[i][col['전화번호'] - 1]) !== tel) sh.getRange(i + 2, col['전화번호']).setValue(safeText(tel));
      if (addr && String(rows[i][col['주소'] - 1]).trim() !== addr) sh.getRange(i + 2, col['주소']).setValue(safeText(addr));
      return;
    }
  }
  const row = new Array(col.width).fill('');
  row[col['현장'] - 1] = safeText(site);
  row[col['이름'] - 1] = safeText(name);
  row[col['전화번호'] - 1] = safeText(tel);
  row[col['주소'] - 1] = safeText(addr);
  sh.getRange(last + 1, 1, 1, col.width).setValues([row]);
}

/** 데이터 행 전부 → [{row, values, linkFormula}] */
function readRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = last - 1;
  const rng = sh.getRange(2, 1, n, HEAD.length);
  const values = rng.getValues();
  const links = sh.getRange(2, COL.LINK, n, 1).getFormulas();
  const imgs = sh.getRange(2, COL.IMG, n, 1).getFormulas();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ row: i + 2, values: values[i], linkFormula: links[i][0], imgFormula: imgs[i][0] });
  }
  return out;
}

/** all=true 면 오래된 입고완료까지 전부 (엑셀 내보내기용) */
function listItems_(all) {
  const sh = sheet_();
  const rows = readRows_(sh);
  const now = Date.now();
  const items = [];
  const missingId = [];
  rows.forEach((r) => {
    if (String(r.values[COL.NAME - 1]).trim() === '') return;
    let id = String(r.values[COL.ID - 1] || '').trim();
    if (!id) { id = newId_(); missingId.push({ row: r.row, id }); }
    const it = rowToItem(r.values, r.linkFormula, id, r.imgFormula);
    it.row = r.row;
    if (!all && it.status === '입고완료' && it.t && now - it.t > CFG.KEEP_DONE_DAYS * 864e5) return;
    items.push(it);
  });
  // 시트에 손으로 적은 줄은 ID가 없다 → 여기서 채워 둔다 (상태 바꾸기·삭제에 필요)
  if (missingId.length) {
    withLock_(() => missingId.forEach((m) => {
      if (String(sh.getRange(m.row, COL.ID).getValue()).trim() === '') sh.getRange(m.row, COL.ID).setValue(m.id);
    }));
  }
  items.sort((a, b) => (b.t || 0) - (a.t || 0) || b.row - a.row);
  return { ok: true, items, now };
}

function addItem_(req) {
  const it = cleanInput(req, true);
  if (it.error) return { ok: false, error: it.error };
  const sh = sheet_();
  // 같은 요청이 두 번 들어오면(전송 재시도) 한 번만 적는다
  if (req.cid) {
    const dup = readRows_(sh).find((r) => String(r.values[COL.ID - 1]) === String(req.cid));
    if (dup) return { ok: true, id: req.cid, dup: true };
  }
  const id = req.cid && /^[A-Za-z0-9_-]{6,40}$/.test(String(req.cid)) ? String(req.cid) : newId_();
  const row = sh.getLastRow() + 1;
  const now = new Date();
  const vals = new Array(HEAD.length).fill('');
  vals[COL.TIME - 1] = now;
  vals[COL.SITE - 1] = safeText(it.site);
  vals[COL.NAME - 1] = safeText(it.name);
  vals[COL.QTY - 1] = safeText(it.qty);
  vals[COL.RCV - 1] = safeText(it.rcv);
  vals[COL.TEL - 1] = safeText(it.tel);
  vals[COL.ADDR - 1] = safeText(it.addr);
  vals[COL.BY - 1] = safeText(it.by);
  vals[COL.STATUS - 1] = '요청';
  vals[COL.MEMO - 1] = safeText(it.memo);
  vals[COL.ID - 1] = id;
  sh.getRange(row, 1, 1, HEAD.length).setValues([vals]);
  if (it.rcv) upsertContact_(it.site, it.rcv, it.tel, it.addr);
  sh.getRange(row, COL.LINK).setFormula(linkFormula(it.link || coupangSearchUrl(it.name), it.link ? linkLabel(it.link) : '쿠팡에서 찾기'));
  return { ok: true, id, row };
}

/**
 * 여러 줄 한꺼번에 등록 (카톡 메모 붙여넣기). rows: [{cid, name, qty, site, rcv, tel, addr, by, memo, link}]
 * 한 번에 setValues 로 적는다. 같은 cid 가 이미 있으면 건너뛴다(전송 재시도). 품명 없는 줄은 errors 로.
 */
function addMany_(req) {
  const rows = Array.isArray(req.rows) ? req.rows.slice(0, PACK_MAX.bulk) : [];
  if (!rows.length) return { ok: false, error: '등록할 물건이 없어요' };
  const sh = sheet_();
  const have = {};
  readRows_(sh).forEach((r) => { have[String(r.values[COL.ID - 1])] = 1; });
  const now = new Date();
  const out = [], ids = [], errors = [], dup = [];
  const contacts = {};
  rows.forEach((src, i) => {
    const it = cleanInput(src || {}, true);
    if (it.error) { errors.push({ i, error: it.error }); return; }
    const okCid = src.cid && /^[A-Za-z0-9_-]{6,40}$/.test(String(src.cid));
    if (okCid && have[String(src.cid)]) { dup.push(String(src.cid)); return; }
    const id = okCid ? String(src.cid) : newId_();
    have[id] = 1;
    const vals = new Array(HEAD.length).fill('');
    vals[COL.TIME - 1] = now;
    vals[COL.SITE - 1] = safeText(it.site);
    vals[COL.NAME - 1] = safeText(it.name);
    vals[COL.LINK - 1] = linkFormula(it.link || coupangSearchUrl(it.name), it.link ? linkLabel(it.link) : '쿠팡에서 찾기');
    vals[COL.QTY - 1] = safeText(it.qty);
    vals[COL.RCV - 1] = safeText(it.rcv);
    vals[COL.TEL - 1] = safeText(it.tel);
    vals[COL.ADDR - 1] = safeText(it.addr);
    vals[COL.BY - 1] = safeText(it.by);
    vals[COL.STATUS - 1] = '요청';
    vals[COL.MEMO - 1] = safeText(it.memo);
    vals[COL.ID - 1] = id;
    out.push(vals); ids.push(id);
    if (it.rcv) contacts[it.site + '|' + it.rcv] = it;
  });
  if (out.length) sh.getRange(sh.getLastRow() + 1, 1, out.length, HEAD.length).setValues(out);
  Object.keys(contacts).forEach((k) => { const c = contacts[k]; upsertContact_(c.site, c.rcv, c.tel, c.addr); });
  return { ok: true, ids, added: ids.length, dup, errors };
}

function updateItem_(req) {
  const sh = sheet_();
  const r = findRow_(sh, req.id);
  if (!r) return { ok: false, error: '이미 지워진 항목입니다', code: 'GONE' };
  const f = req.fields || {};
  if (f.status !== undefined) {
    const s = normalizeStatus(f.status);
    if (!s) return { ok: false, error: '상태 값이 잘못됐습니다' };
    sh.getRange(r.row, COL.STATUS).setValue(s);
  }
  const it = cleanInput(f, false);
  if (it.error) return { ok: false, error: it.error };
  if (f.qty !== undefined) sh.getRange(r.row, COL.QTY).setValue(safeText(it.qty));
  if (f.memo !== undefined) sh.getRange(r.row, COL.MEMO).setValue(safeText(it.memo));
  if (f.site !== undefined) sh.getRange(r.row, COL.SITE).setValue(safeText(it.site));
  if (f.rcv !== undefined) sh.getRange(r.row, COL.RCV).setValue(safeText(it.rcv));
  if (f.tel !== undefined) sh.getRange(r.row, COL.TEL).setValue(safeText(it.tel));
  if (f.addr !== undefined) sh.getRange(r.row, COL.ADDR).setValue(safeText(it.addr));
  if (f.rcv !== undefined || f.tel !== undefined || f.addr !== undefined) {
    const rcv = f.rcv !== undefined ? it.rcv : String(r.values[COL.RCV - 1]).trim();
    const site = f.site !== undefined ? it.site : String(r.values[COL.SITE - 1]).trim();
    const tel = f.tel !== undefined ? it.tel : normalizePhone(r.values[COL.TEL - 1]);
    const addr = f.addr !== undefined ? it.addr : String(r.values[COL.ADDR - 1]).trim();
    if (rcv) upsertContact_(site, rcv, tel, addr);
  }
  if (f.name !== undefined) {
    if (!it.name) return { ok: false, error: '품명을 적어주세요' };
    sh.getRange(r.row, COL.NAME).setValue(safeText(it.name));
  }
  if (f.link !== undefined || f.name !== undefined) {
    // 직접 넣은 상품 링크가 있으면 유지, 검색 링크면 새 품명으로 다시 만든다
    const name = f.name !== undefined ? it.name : String(r.values[COL.NAME - 1]);
    let link = f.link !== undefined ? it.link : urlFromFormula(r.linkFormula);
    if (link && isSearchUrl(link)) link = '';
    sh.getRange(r.row, COL.LINK).setFormula(linkFormula(link || coupangSearchUrl(name), link ? linkLabel(link) : '쿠팡에서 찾기'));
    if (f.link !== undefined) sh.getRange(r.row, COL.IMG).clearContent(); // 상품이 바뀌면 사진도 새로
  }
  return { ok: true };
}

// ── 쿠팡 사진 ─────────────────────────────────────────────────
// 상품 링크의 대표 이미지(og:image)를 서버에서 받아 '사진' 칸에 =IMAGE() 로 넣는다.
// 쿠팡이 자동 접속을 막으면 실패한다 → 실패 이유(응답 코드)를 그대로 돌려줘서 화면에 보여준다.
function thumbItem_(req) {
  const sh = sheet_();
  const r = findRow_(sh, req.id);
  if (!r) return { ok: false, error: '이미 지워진 항목입니다', code: 'GONE' };
  const link = urlFromFormula(r.linkFormula) || extractUrl(String(r.values[COL.LINK - 1]));
  if (!link || isSearchUrl(link)) return { ok: false, error: '상품 링크가 없어요', code: 'NOLINK' };
  const got = fetchThumb_(link);
  if (!got.img) return { ok: false, error: got.error, code: 'BLOCKED', tries: got.tries };
  withLock_(() => {
    const again = findRow_(sh, req.id);
    if (again) sh.getRange(again.row, COL.IMG).setFormula(imageFormula(got.img));
  });
  return { ok: true, img: got.img };
}

function fetchThumb_(link) {
  const cache = CacheService.getScriptCache();
  const key = 'img:' + Utilities.base64EncodeWebSafe(link).slice(0, 200);
  const hit = cache.get(key);
  if (hit) return { img: hit };
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const opt = (follow) => ({
    muteHttpExceptions: true, followRedirects: follow,
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Accept: 'text/html,application/xhtml+xml' },
  });
  const tries = [];
  let url = link;
  // link.coupang.com 짧은 주소 → 실제 상품 주소 (Location 헤더)
  if (/link\.coupang\.com/.test(link)) {
    try {
      const res = UrlFetchApp.fetch(link, opt(false));
      const loc = res.getHeaders().Location || res.getHeaders().location;
      tries.push('짧은주소 ' + res.getResponseCode());
      if (loc) url = loc;
    } catch (e) { tries.push('짧은주소 오류'); }
  }
  const cands = [url];
  const m = url.match(/products\/(\d+)/);
  if (m) {
    const q = (url.split('?')[1] || '');
    cands.push('https://m.coupang.com/vm/products/' + m[1] + (q ? '?' + q : ''));
  }
  for (let i = 0; i < cands.length; i++) {
    try {
      const res = UrlFetchApp.fetch(cands[i], opt(true));
      const code = res.getResponseCode();
      tries.push((/m\.coupang/.test(cands[i]) ? '모바일 ' : '') + code);
      if (code === 200) {
        const img = ogImage(res.getContentText());
        if (img) { try { cache.put(key, img, 21600); } catch (e) { /* 무시 */ } return { img, tries }; }
      }
    } catch (e) { tries.push('오류'); }
  }
  return { error: '쿠팡에서 사진을 못 받았어요 (' + tries.join(', ') + ')', tries };
}

function removeItem_(req) {
  const sh = sheet_();
  const r = findRow_(sh, req.id);
  if (!r) return { ok: true, gone: true };
  sh.deleteRow(r.row);
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════
// 물품팩 — 자주 시키는 물건 묶음 ('물품팩' 탭. 시트에서 직접 고쳐도 된다)
// ═════════════════════════════════════════════════════════════

function packSheet_(create) {
  const ss = ss_();
  let sh = ss.getSheetByName(PACK_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(PACK_SHEET);
    sh.getRange(1, 1, 1, PACK_HEAD.length).setValues([PACK_HEAD]).setFontWeight('bold').setBackground(COLOR.head).setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange('C:C').setNumberFormat('@'); // 수량 '1/2' 같은 글자가 날짜로 바뀌지 않게
    sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 220); sh.setColumnWidth(3, 70); sh.setColumnWidth(4, 360);
  }
  return sh;
}

/** [{name, items:[{name, qty, link}]}] — 탭에 적힌 순서대로. 품목 칸이 빈 줄은 '빈 팩' 자리 */
function readPacks_() {
  const sh = packSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, PACK_HEAD.length).getValues();
  const order = [], by = {};
  vals.forEach((v) => {
    const p = String(v[0] == null ? '' : v[0]).trim();
    if (!p) return;
    if (!by[p]) { by[p] = { name: p, items: [] }; order.push(p); }
    const name = String(v[1] == null ? '' : v[1]).trim();
    if (name) by[p].items.push({ name, qty: String(v[2] == null ? '' : v[2]).trim(), link: extractUrl(String(v[3] == null ? '' : v[3])) });
  });
  return order.map((k) => by[k]);
}

function writePacks_(packs) {
  const sh = packSheet_(true);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, PACK_HEAD.length).clearContent();
  const rows = [];
  packs.forEach((p) => {
    if (!p.items.length) rows.push([safeText(p.name), '', '', '']);
    p.items.forEach((it) => rows.push([safeText(p.name), safeText(it.name), safeText(it.qty), it.link]));
  });
  if (rows.length) sh.getRange(2, 1, rows.length, PACK_HEAD.length).setValues(rows);
}

function cleanPack_(req) {
  const name = clip_(req.name, 30).replace(/\s*\n\s*/g, ' ');
  if (!name) return { error: '팩 이름을 적어주세요' };
  const items = [];
  (Array.isArray(req.items) ? req.items : []).slice(0, PACK_MAX.items).forEach((src) => {
    const n = clip_(src && src.name, LIMIT.name).replace(/\s*\n\s*/g, ' ');
    if (!n) return;
    items.push({ name: n, qty: clip_(src.qty, LIMIT.qty), link: extractUrl(clip_(src.link, LIMIT.link)) });
  });
  return { name, items };
}

/** {name, old?, items} — old 가 있으면 그 팩을 바꾼다(이름 바꾸기 포함), 없으면 같은 이름 팩을 바꾸거나 새로 만든다 */
function savePack_(req) {
  const p = cleanPack_(req);
  if (p.error) return { ok: false, error: p.error };
  const packs = readPacks_();
  const old = clip_(req.old, 30);
  const at = packs.findIndex((x) => x.name === (old || p.name));
  if (packs.some((x, i) => x.name === p.name && i !== at)) return { ok: false, error: '같은 이름의 팩이 이미 있어요' };
  if (at >= 0) packs[at] = p;
  else if (packs.length >= PACK_MAX.packs) return { ok: false, error: '팩은 ' + PACK_MAX.packs + '개까지예요' };
  else packs.push(p);
  writePacks_(packs);
  return { ok: true, packs };
}

function removePack_(req) {
  const name = clip_(req.name, 30);
  const packs = readPacks_().filter((x) => x.name !== name);
  writePacks_(packs);
  return { ok: true, packs };
}

function findRow_(sh, id) {
  if (!id) return null;
  return readRows_(sh).find((r) => String(r.values[COL.ID - 1]) === String(id)) || null;
}

function newId_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

// ═════════════════════════════════════════════════════════════
// 시트에서 직접 고칠 때
// ═════════════════════════════════════════════════════════════

/** 휴대폰으로 설치한 경우(따로 만든 스크립트)의 시트 수정 트리거 */
function onSheetEdit(e) { onEdit(e); }

function onEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== CFG.SHEET) return;
  const r0 = e.range.getRow(), c0 = e.range.getColumn();
  const r1 = r0 + e.range.getNumRows() - 1, c1 = c0 + e.range.getNumColumns() - 1;
  if (r1 < 2) return;
  const touchesName = c0 <= COL.NAME && c1 >= COL.NAME;
  const touchesLink = c0 <= COL.LINK && c1 >= COL.LINK;
  if (!touchesName && !touchesLink) return;
  for (let row = Math.max(2, r0); row <= Math.min(r1, r0 + 200); row++) fixRow_(sh, row);
}

/** 한 줄의 빈 칸(링크·ID·등록일시·상태)을 채운다 */
function fixRow_(sh, row) {
  const v = sh.getRange(row, 1, 1, HEAD.length).getValues()[0];
  const name = String(v[COL.NAME - 1]).trim();
  const linkCell = sh.getRange(row, COL.LINK);
  const f = linkCell.getFormula();
  if (!name) {
    if (f && isSearchUrl(urlFromFormula(f))) linkCell.clearContent();
    return;
  }
  const typed = f ? urlFromFormula(f) : extractUrl(String(v[COL.LINK - 1]));
  const link = typed && !isSearchUrl(typed) ? typed : '';
  linkCell.setFormula(linkFormula(link || coupangSearchUrl(name), link ? linkLabel(link) : '쿠팡에서 찾기'));
  if (!v[COL.TIME - 1]) sh.getRange(row, COL.TIME).setValue(new Date());
  if (!String(v[COL.STATUS - 1]).trim()) sh.getRange(row, COL.STATUS).setValue('요청');
  if (!String(v[COL.ID - 1]).trim()) sh.getRange(row, COL.ID).setValue(newId_());
}

// ═════════════════════════════════════════════════════════════
// 메뉴 · 처음 설정
// ═════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi().createMenu('청소용품 앱')
    .addItem('① 처음 설정', 'setup')
    .addItem('② 휴대폰 연결 링크 만들기', 'showLink')
    .addSeparator()
    .addItem('팀 코드 새로 바꾸기', 'resetKey')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(CFG.TZ);
  let sh = ss.getSheetByName(CFG.SHEET);
  if (!sh) sh = ss.insertSheet(CFG.SHEET, 0);
  formatSheet_(sh);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TEAM_KEY')) props.setProperty('TEAM_KEY', makeKey_());
  SpreadsheetApp.getUi().alert(
    '설정 완료',
    "'" + CFG.SHEET + "' 시트를 만들었습니다.\n\n" +
    '다음 단계: [배포 → 새 배포 → 웹 앱]으로 배포한 뒤\n' +
    '[청소용품 앱 → ② 휴대폰 연결 링크 만들기]를 누르세요.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function resetKey() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('팀 코드 바꾸기', '지금 쓰는 휴대폰들은 모두 새 링크로 다시 연결해야 합니다. 바꿀까요?', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty('TEAM_KEY', makeKey_());
  showLink();
}

function makeKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function showLink() {
  const ui = SpreadsheetApp.getUi();
  const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
  if (!key) { ui.alert('먼저 [① 처음 설정]을 눌러주세요.'); return; }
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }
  if (!/\/exec$/.test(url)) {
    const res = ui.prompt('웹 앱 주소',
      '[배포 → 배포 관리]에 있는 웹 앱 주소(…/exec 로 끝남)를 붙여넣으세요.', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    url = res.getResponseText().trim();
  }
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    ui.alert('주소가 …/exec 로 끝나야 합니다. 다시 확인해 주세요.');
    return;
  }
  const c = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, k: key }), Utilities.Charset.UTF_8).replace(/=+$/, '');
  const links = [];
  if (CFG.PAGE_URL) links.push({ label: '앱 링크 (GitHub)', href: CFG.PAGE_URL + '#c=' + c });
  links.push({ label: (CFG.PAGE_URL ? '예비 링크 (GitHub가 안 열릴 때)' : '앱 링크'), href: url + '?c=' + c });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const html =
    '<div style="font:14px/1.5 Arial,sans-serif;color:#1f2937">' +
    '<p>이 링크를 카카오톡으로 보내서 휴대폰에서 여세요.<br>링크에 팀 코드가 들어 있으니 <b>팀 밖으로는 보내지 마세요.</b></p>' +
    links.map((l, i) =>
      '<p style="margin:14px 0 4px"><b>' + esc(l.label) + '</b></p>' +
      '<textarea id="t' + i + '" readonly style="width:100%;height:64px;font:12px monospace">' + esc(l.href) + '</textarea>' +
      '<button onclick="var t=document.getElementById(\'t' + i + '\');t.select();document.execCommand(\'copy\');this.textContent=\'복사됨 ✓\'" ' +
      'style="margin-top:4px;padding:6px 14px">복사</button>').join('') +
    '</div>';
  ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(CFG.PAGE_URL ? 380 : 240), '휴대폰 연결 링크');
}

function formatSheet_(sh) {
  const L = (c) => colLetter(c);
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD])
    .setFontWeight('bold').setBackground(COLOR.head).setFontColor(COLOR.headInk)
    .setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  const widths = { TIME: 130, SITE: 150, NAME: 200, LINK: 280, IMG: 70, QTY: 70, RCV: 80, TEL: 120, ADDR: 260, BY: 80, STATUS: 80, MEMO: 220, ID: 90 };
  Object.keys(widths).forEach((k) => sh.setColumnWidth(COL[k], widths[k]));
  sh.getRange(L(COL.TIME) + '2:' + L(COL.TIME)).setNumberFormat('yyyy-mm-dd hh:mm');
  sh.getRange(L(COL.TEL) + '2:' + L(COL.TEL)).setNumberFormat('@'); // 연락처: 맨 앞 0 이 잘리지 않게 글자로
  [COL.QTY, COL.BY, COL.STATUS].forEach((c) => sh.getRange(L(c) + '2:' + L(c)).setHorizontalAlignment('center'));
  sh.hideColumns(COL.ID);

  // 상태 드롭다운 — 목록 밖 값은 경고만 (입력 거부 X)
  const st = sh.getRange(L(COL.STATUS) + '2:' + L(COL.STATUS));
  st.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build());

  const data = sh.getRange('A2:' + L(HEAD.length));
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + L(COL.STATUS) + '2="입고완료"')
      .setFontColor(COLOR.doneInk).setBackground(COLOR.done).setRanges([data]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('요청')
      .setBackground(COLOR.req).setFontColor(COLOR.reqInk).setBold(true).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('주문완료')
      .setBackground(COLOR.ord).setFontColor(COLOR.ordInk).setBold(true).setRanges([st]).build(),
  ]);
}

// ═════════════════════════════════════════════════════════════
// 순수 함수 (node 로 검증: test/test.js)
// ═════════════════════════════════════════════════════════════

function coupangSearchUrl(name) {
  return 'https://www.coupang.com/np/search?q=' + encodeURIComponent(String(name || '').trim());
}

function isSearchUrl(url) {
  return /coupang\.com\/np\/search/.test(String(url || ''));
}

/** "[쿠팡] 상품명 https://link.coupang.com/a/abc" 같은 공유 문구에서 주소만 꺼낸다 */
function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0].replace(/[),.\]]+$/, '') : '';
}

function linkLabel(url) {
  return /coupang\.com/.test(url) ? '쿠팡 상품' : '상품 링크';
}

/**
 * 쿠팡 칸 수식. 보이는 글자 = 주소 전체 (2026-11-17 사용자: "쿠팡 링크라고 하지 말고 링크 전체를 노출").
 * 검색 주소의 %EB%9D%BD… 은 한글로 풀어서 보여준다 (누르면 원래 주소로 열림). label 인자는 옛 호출 호환용으로 무시.
 */
function linkFormula(url, label) {
  const q = (s) => String(s).replace(/"/g, '""');
  return '=HYPERLINK("' + q(String(url).replace(/"/g, '%22')) + '","' + q(displayUrl(url)) + '")';
}

function displayUrl(url) {
  try { return decodeURIComponent(String(url)); } catch (e) { return String(url); }
}

/** 예전에 '쿠팡 상품'/'쿠팡에서 찾기' 글자로 적힌 쿠팡 칸을 주소 전체로 한 번 바꾼다 */
function relabelLinks_(sh) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('LINK_LABEL') === 'url') return;
  const last = sh.getLastRow();
  if (last >= 2) {
    const rng = sh.getRange(2, COL.LINK, last - 1, 1);
    const fs = rng.getFormulas();
    let changed = false;
    const out = fs.map((r) => {
      const u = urlFromFormula(r[0]);
      if (!u) return [r[0]];
      const f = linkFormula(u);
      if (f !== r[0]) changed = true;
      return [f];
    });
    if (changed) out.forEach((r, i) => { if (r[0]) sh.getRange(i + 2, COL.LINK).setFormula(r[0]); });
  }
  sh.setColumnWidth(COL.LINK, 280);
  props.setProperty('LINK_LABEL', 'url');
}

function urlFromFormula(f) {
  const m = String(f || '').match(/^=\s*HYPERLINK\(\s*"((?:[^"]|"")*)"/i);
  return m ? m[1].replace(/""/g, '"') : '';
}

function normalizeStatus(s) {
  s = String(s || '').replace(/\s/g, '');
  if (s === '' || s === '요청' || s === '요청중') return '요청';
  if (s === '주문완료' || s === '주문' || s === '주문함') return '주문완료';
  if (s === '입고완료' || s === '입고' || s === '받음') return '입고완료';
  return '';
}

/** 시트에 적을 때 =,+,@ 로 시작하면 수식으로 바뀌지 않게 막는다 */
function safeText(s) {
  s = String(s == null ? '' : s);
  return /^[=+@]/.test(s) ? "'" + s : s;
}

function clip_(s, n) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, n);
}

/** 앱에서 온 값 정리. requireName=true 면 품명 필수 */
function cleanInput(src, requireName) {
  const out = {
    name: clip_(src.name, LIMIT.name).replace(/\s*\n\s*/g, ' '),
    site: clip_(src.site, LIMIT.site),
    qty: clip_(src.qty, LIMIT.qty),
    by: clip_(src.by, LIMIT.by),
    memo: clip_(src.memo, LIMIT.memo),
    addr: clip_(src.addr, LIMIT.addr).replace(/\s*\n\s*/g, ' '),
    rcv: clip_(src.rcv, LIMIT.rcv),
    tel: normalizePhone(clip_(src.tel, LIMIT.tel)),
    link: '',
  };
  if (requireName && !out.name) return { error: '품명을 적어주세요' };
  if (src.link) {
    const u = extractUrl(clip_(src.link, LIMIT.link));
    if (!u) return { error: '링크는 https:// 로 시작하는 주소여야 합니다' };
    out.link = u;
  }
  return out;
}

function rowToItem(v, linkFormulaText, id, imgFormulaText) {
  const t = v[COL.TIME - 1];
  const time = t instanceof Date ? t.getTime() : (t ? Date.parse(String(t).replace(' ', 'T')) || 0 : 0);
  const name = String(v[COL.NAME - 1]).trim();
  let link = urlFromFormula(linkFormulaText) || extractUrl(String(v[COL.LINK - 1]));
  const custom = !!link && !isSearchUrl(link);
  if (!link) link = coupangSearchUrl(name);
  return {
    id: id || String(v[COL.ID - 1]),
    t: time,
    site: String(v[COL.SITE - 1]).trim(),
    name,
    link,
    custom,
    qty: String(v[COL.QTY - 1]).trim(),
    by: String(v[COL.BY - 1]).trim(),
    status: normalizeStatus(v[COL.STATUS - 1]) || String(v[COL.STATUS - 1]).trim(),
    memo: String(v[COL.MEMO - 1]).trim(),
    rcv: String(v[COL.RCV - 1]).trim(),
    tel: normalizePhone(v[COL.TEL - 1]),
    addr: String(v[COL.ADDR - 1] == null ? '' : v[COL.ADDR - 1]).trim(),
    img: imageFromFormula(imgFormulaText) || (/^https?:\/\//.test(String(v[COL.IMG - 1] || '')) ? String(v[COL.IMG - 1]) : ''),
  };
}

function colLetter(c) {
  let s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}

function imageFormula(url) {
  return '=IMAGE("' + String(url).replace(/"/g, '%22') + '")';
}

function imageFromFormula(f) {
  const m = String(f || '').match(/^=\s*IMAGE\(\s*"([^"]*)"/i);
  return m ? m[1] : '';
}

/** 상품 페이지 HTML 에서 대표 이미지 주소 (og:image, 없으면 쿠팡 썸네일 주소) */
function ogImage(html) {
  html = String(html || '');
  let m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  let u = m ? m[1] : '';
  if (!u) {
    m = html.match(/(?:https?:)?\/\/thumbnail\d*\.coupangcdn\.com\/[^"'\s)<>]+?\.(?:jpe?g|png|webp)/i);
    u = m ? m[0] : '';
  }
  if (!u) return '';
  u = u.replace(/&amp;/g, '&');
  if (u.indexOf('//') === 0) u = 'https:' + u;
  return /^https?:\/\//.test(u) ? u : '';
}

/** 전화번호를 010-1234-5678 꼴로. 시트가 숫자로 바꾸며 맨 앞 0 을 잘랐어도(1012345678) 되살린다. 모르는 꼴은 그대로. */
function normalizePhone(s) {
  const raw = String(s == null ? '' : s).trim();
  let d = raw.replace(/[^0-9]/g, '');
  if (!d) return raw;
  if (/^1[016789]\d{7,8}$/.test(d)) d = '0' + d; // 앞 0 이 잘린 휴대폰 번호
  if (/^01[016789]\d{7,8}$/.test(d)) return d.slice(0, 3) + '-' + d.slice(3, d.length - 4) + '-' + d.slice(-4);
  if (/^02\d{7,8}$/.test(d)) return '02-' + d.slice(2, d.length - 4) + '-' + d.slice(-4);
  if (/^0\d{9,10}$/.test(d)) return d.slice(0, 3) + '-' + d.slice(3, d.length - 4) + '-' + d.slice(-4);
  return raw;
}

if (typeof module !== 'undefined') {
  module.exports = { coupangSearchUrl, isSearchUrl, extractUrl, linkFormula, urlFromFormula, normalizeStatus, safeText, cleanInput, rowToItem, normalizePhone, ogImage, colLetter, siteOf };
}
