/* 청소용품 요청 서버 (붙여넣기용: 주석을 뺀 Code.gs). 원본 https://github.com/endia4644/request */
const CFG = {
SHEET: '청소용품',
PAGE_URL: 'https://endia4644.github.io/request/',
RAW_INDEX: 'https://raw.githubusercontent.com/endia4644/request/main/index.html',
SS_NAME: '청소용품 요청',
TZ: 'Asia/Seoul',
KEEP_DONE_DAYS: 90
};

const HEAD = [ '등록일시', '현장', '품명', '쿠팡', '사진', '수량', '수취인', '연락처', '주소', '등록자', '상태', '메모', 'ID' ];

const COL = {
TIME: 1,
SITE: 2,
NAME: 3,
LINK: 4,
IMG: 5,
QTY: 6,
RCV: 7,
TEL: 8,
ADDR: 9,
BY: 10,
STATUS: 11,
MEMO: 12,
ID: 13
};

const CONTACT_SHEET = '수취인';

const CONTACT_HEAD = [ '구분', '현장', '이름', '전화번호', '주소' ];

const STATUSES = [ '요청', '주문완료', '입고완료' ];

const LIMIT = {
name: 80,
site: 40,
qty: 20,
by: 20,
memo: 300,
link: 500,
rcv: 20,
tel: 20,
addr: 120
};

const COLOR = {
head: '#1f2937',
headInk: '#ffffff',
line: '#e5e7eb',
req: '#fff4cc',
reqInk: '#8a6100',
ord: '#e8f0fe',
ordInk: '#1a56db',
done: '#f3f4f6',
doneInk: '#9ca3af'
};

function doGet(e) {
const p = e && e.parameter || {};
if (!p.action) {
return appHtml_().setTitle('청소용품').addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
return json_(handle_(p));
}

function doPost(e) {
let req;
try {
req = JSON.parse(e && e.postData && e.postData.contents || '{}');
} catch (err) {
return json_({
ok: false,
error: '요청 형식이 잘못됐습니다'
});
}
return json_(handle_(req));
}

function api(reqText) {
let req;
try {
req = JSON.parse(reqText || '{}');
} catch (err) {
return JSON.stringify({
ok: false,
error: '요청 형식이 잘못됐습니다'
});
}
return JSON.stringify(handle_(req));
}

function appHtml_() {
try {
return HtmlService.createHtmlOutputFromFile('index');
} catch (err) {}
const cache = CacheService.getScriptCache();
let html = cache.get('index');
if (!html) {
html = UrlFetchApp.fetch(CFG.RAW_INDEX).getContentText();
try {
cache.put('index', html, 3600);
} catch (err) {}
}
return HtmlService.createHtmlOutput(html);
}

function json_(obj) {
return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
try {
if (req.action === 'init') return withLock_((() => init_(req)));
const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
if (!key) return {
ok: false,
error: '아직 설치가 안 끝났어요. 앱의 [처음 설치] 화면에서 이 주소를 넣어주세요',
code: 'NOINIT'
};
if (String(req.k || '') !== key) return {
ok: false,
error: '팀 코드가 맞지 않습니다',
code: 'KEY'
};
switch (req.action) {
case 'info':
return {
ok: true,
sheetUrl: ss_().getUrl()
};

case 'list':
{
const r = listItems_(String(req.all || '') === '1');
if (String(req.contacts || '') === '1') r.contacts = readContacts_();
return r;
}

case 'add':
return withLock_((() => addItem_(req)));

case 'update':
return withLock_((() => updateItem_(req)));

case 'remove':
return withLock_((() => removeItem_(req)));

case 'thumb':
return thumbItem_(req);

default:
return {
ok: false,
error: '알 수 없는 요청: ' + req.action
};
}
} catch (err) {
return {
ok: false,
error: String(err && err.message || err)
};
}
}

function withLock_(fn) {
const lock = LockService.getScriptLock();
lock.waitLock(15e3);
try {
const r = fn();
SpreadsheetApp.flush();
return r;
} finally {
lock.releaseLock();
}
}

function init_(req) {
const props = PropertiesService.getScriptProperties();
const key = props.getProperty('TEAM_KEY');
if (key) {
if (String(req.k || '') === key) return {
ok: true,
k: key,
sheetUrl: ss_().getUrl(),
again: true
};
return {
ok: false,
error: '이미 설치된 주소예요. 관리자에게 연결 링크를 받아주세요',
code: 'INIT_DONE'
};
}
sheet_();
const k = makeKey_();
props.setProperty('TEAM_KEY', k);
return {
ok: true,
k: k,
sheetUrl: ss_().getUrl()
};
}

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
return sh;
}

function migrate_(sh) {
const width = Math.max(sh.getLastColumn(), 1);
const head = sh.getRange(1, 1, 1, width).getValues()[0].map((v => String(v).trim()));
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

function contactSheet_() {
const ss = ss_();
let sh = ss.getSheetByName(CONTACT_SHEET);
if (!sh) {
sh = ss.insertSheet(CONTACT_SHEET);
sh.getRange(1, 1, 1, CONTACT_HEAD.length).setValues([ CONTACT_HEAD ]).setFontWeight('bold').setBackground(COLOR.head).setFontColor(COLOR.headInk).setHorizontalAlignment('center');
sh.setFrozenRows(1);
[ 130, 170, 90, 130, 320 ].forEach(((w, i) => sh.setColumnWidth(i + 1, w)));
sh.getRange('D2:D').setNumberFormat('@');
}
return sh;
}

function contactCols_(sh) {
const width = Math.max(sh.getLastColumn(), 1);
const head = sh.getRange(1, 1, 1, width).getValues()[0].map((v => String(v).trim()));
const col = {};
CONTACT_HEAD.forEach((h => {
let i = head.indexOf(h);
if (i < 0 && h === '전화번호') i = head.indexOf('연락처');
if (i < 0 && h === '이름') i = head.indexOf('성명');
if (i < 0) {
head.push(h);
i = head.length - 1;
sh.getRange(1, i + 1).setValue(h);
}
col[h] = i + 1;
}));
col.width = head.length;
return col;
}

function readContacts_() {
const sh = contactSheet_();
const last = sh.getLastRow();
if (last < 2) return [];
const col = contactCols_(sh);
return sh.getRange(2, 1, last - 1, col.width).getValues().map((v => ({
grp: String(v[col['구분'] - 1] || '').trim(),
site: String(v[col['현장'] - 1] || '').trim(),
name: String(v[col['이름'] - 1] || '').trim(),
tel: normalizePhone(v[col['전화번호'] - 1]),
addr: String(v[col['주소'] - 1] || '').trim()
}))).filter((c => c.name));
}

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
sh.getRange(last + 1, 1, 1, col.width).setValues([ row ]);
}

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
out.push({
row: i + 2,
values: values[i],
linkFormula: links[i][0],
imgFormula: imgs[i][0]
});
}
return out;
}

function listItems_(all) {
const sh = sheet_();
const rows = readRows_(sh);
const now = Date.now();
const items = [];
const missingId = [];
rows.forEach((r => {
if (String(r.values[COL.NAME - 1]).trim() === '') return;
let id = String(r.values[COL.ID - 1] || '').trim();
if (!id) {
id = newId_();
missingId.push({
row: r.row,
id: id
});
}
const it = rowToItem(r.values, r.linkFormula, id, r.imgFormula);
it.row = r.row;
if (!all && it.status === '입고완료' && it.t && now - it.t > CFG.KEEP_DONE_DAYS * 864e5) return;
items.push(it);
}));
if (missingId.length) {
withLock_((() => missingId.forEach((m => {
if (String(sh.getRange(m.row, COL.ID).getValue()).trim() === '') sh.getRange(m.row, COL.ID).setValue(m.id);
}))));
}
items.sort(((a, b) => (b.t || 0) - (a.t || 0) || b.row - a.row));
return {
ok: true,
items: items,
now: now
};
}

function addItem_(req) {
const it = cleanInput(req, true);
if (it.error) return {
ok: false,
error: it.error
};
const sh = sheet_();
if (req.cid) {
const dup = readRows_(sh).find((r => String(r.values[COL.ID - 1]) === String(req.cid)));
if (dup) return {
ok: true,
id: req.cid,
dup: true
};
}
const id = req.cid && /^[A-Za-z0-9_-]{6,40}$/.test(String(req.cid)) ? String(req.cid) : newId_();
const row = sh.getLastRow() + 1;
const now = new Date;
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
sh.getRange(row, 1, 1, HEAD.length).setValues([ vals ]);
if (it.rcv) upsertContact_(it.site, it.rcv, it.tel, it.addr);
sh.getRange(row, COL.LINK).setFormula(linkFormula(it.link || coupangSearchUrl(it.name), it.link ? linkLabel(it.link) : '쿠팡에서 찾기'));
return {
ok: true,
id: id,
row: row
};
}

function updateItem_(req) {
const sh = sheet_();
const r = findRow_(sh, req.id);
if (!r) return {
ok: false,
error: '이미 지워진 항목입니다',
code: 'GONE'
};
const f = req.fields || {};
if (f.status !== undefined) {
const s = normalizeStatus(f.status);
if (!s) return {
ok: false,
error: '상태 값이 잘못됐습니다'
};
sh.getRange(r.row, COL.STATUS).setValue(s);
}
const it = cleanInput(f, false);
if (it.error) return {
ok: false,
error: it.error
};
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
if (!it.name) return {
ok: false,
error: '품명을 적어주세요'
};
sh.getRange(r.row, COL.NAME).setValue(safeText(it.name));
}
if (f.link !== undefined || f.name !== undefined) {
const name = f.name !== undefined ? it.name : String(r.values[COL.NAME - 1]);
let link = f.link !== undefined ? it.link : urlFromFormula(r.linkFormula);
if (link && isSearchUrl(link)) link = '';
sh.getRange(r.row, COL.LINK).setFormula(linkFormula(link || coupangSearchUrl(name), link ? linkLabel(link) : '쿠팡에서 찾기'));
if (f.link !== undefined) sh.getRange(r.row, COL.IMG).clearContent();
}
return {
ok: true
};
}

function thumbItem_(req) {
const sh = sheet_();
const r = findRow_(sh, req.id);
if (!r) return {
ok: false,
error: '이미 지워진 항목입니다',
code: 'GONE'
};
const link = urlFromFormula(r.linkFormula) || extractUrl(String(r.values[COL.LINK - 1]));
if (!link || isSearchUrl(link)) return {
ok: false,
error: '상품 링크가 없어요',
code: 'NOLINK'
};
const got = fetchThumb_(link);
if (!got.img) return {
ok: false,
error: got.error,
code: 'BLOCKED',
tries: got.tries
};
withLock_((() => {
const again = findRow_(sh, req.id);
if (again) sh.getRange(again.row, COL.IMG).setFormula(imageFormula(got.img));
}));
return {
ok: true,
img: got.img
};
}

function fetchThumb_(link) {
const cache = CacheService.getScriptCache();
const key = 'img:' + Utilities.base64EncodeWebSafe(link).slice(0, 200);
const hit = cache.get(key);
if (hit) return {
img: hit
};
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const opt = follow => ({
muteHttpExceptions: true,
followRedirects: follow,
headers: {
'User-Agent': UA,
'Accept-Language': 'ko-KR,ko;q=0.9',
Accept: 'text/html,application/xhtml+xml'
}
});
const tries = [];
let url = link;
if (/link\.coupang\.com/.test(link)) {
try {
const res = UrlFetchApp.fetch(link, opt(false));
const loc = res.getHeaders().Location || res.getHeaders().location;
tries.push('짧은주소 ' + res.getResponseCode());
if (loc) url = loc;
} catch (e) {
tries.push('짧은주소 오류');
}
}
const cands = [ url ];
const m = url.match(/products\/(\d+)/);
if (m) {
const q = url.split('?')[1] || '';
cands.push('https://m.coupang.com/vm/products/' + m[1] + (q ? '?' + q : ''));
}
for (let i = 0; i < cands.length; i++) {
try {
const res = UrlFetchApp.fetch(cands[i], opt(true));
const code = res.getResponseCode();
tries.push((/m\.coupang/.test(cands[i]) ? '모바일 ' : '') + code);
if (code === 200) {
const img = ogImage(res.getContentText());
if (img) {
try {
cache.put(key, img, 21600);
} catch (e) {}
return {
img: img,
tries: tries
};
}
}
} catch (e) {
tries.push('오류');
}
}
return {
error: '쿠팡에서 사진을 못 받았어요 (' + tries.join(', ') + ')',
tries: tries
};
}

function removeItem_(req) {
const sh = sheet_();
const r = findRow_(sh, req.id);
if (!r) return {
ok: true,
gone: true
};
sh.deleteRow(r.row);
return {
ok: true
};
}

function findRow_(sh, id) {
if (!id) return null;
return readRows_(sh).find((r => String(r.values[COL.ID - 1]) === String(id))) || null;
}

function newId_() {
return Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function onSheetEdit(e) {
onEdit(e);
}

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
if (!v[COL.TIME - 1]) sh.getRange(row, COL.TIME).setValue(new Date);
if (!String(v[COL.STATUS - 1]).trim()) sh.getRange(row, COL.STATUS).setValue('요청');
if (!String(v[COL.ID - 1]).trim()) sh.getRange(row, COL.ID).setValue(newId_());
}

function onOpen() {
SpreadsheetApp.getUi().createMenu('청소용품 앱').addItem('① 처음 설정', 'setup').addItem('② 휴대폰 연결 링크 만들기', 'showLink').addSeparator().addItem('팀 코드 새로 바꾸기', 'resetKey').addToUi();
}

function setup() {
const ss = SpreadsheetApp.getActiveSpreadsheet();
ss.setSpreadsheetTimeZone(CFG.TZ);
let sh = ss.getSheetByName(CFG.SHEET);
if (!sh) sh = ss.insertSheet(CFG.SHEET, 0);
formatSheet_(sh);
const props = PropertiesService.getScriptProperties();
if (!props.getProperty('TEAM_KEY')) props.setProperty('TEAM_KEY', makeKey_());
SpreadsheetApp.getUi().alert('설정 완료', '\'' + CFG.SHEET + '\' 시트를 만들었습니다.\n\n' + '다음 단계: [배포 → 새 배포 → 웹 앱]으로 배포한 뒤\n' + '[청소용품 앱 → ② 휴대폰 연결 링크 만들기]를 누르세요.', SpreadsheetApp.getUi().ButtonSet.OK);
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
if (!key) {
ui.alert('먼저 [① 처음 설정]을 눌러주세요.');
return;
}
let url = '';
try {
url = ScriptApp.getService().getUrl() || '';
} catch (err) {
url = '';
}
if (!/\/exec$/.test(url)) {
const res = ui.prompt('웹 앱 주소', '[배포 → 배포 관리]에 있는 웹 앱 주소(…/exec 로 끝남)를 붙여넣으세요.', ui.ButtonSet.OK_CANCEL);
if (res.getSelectedButton() !== ui.Button.OK) return;
url = res.getResponseText().trim();
}
if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
ui.alert('주소가 …/exec 로 끝나야 합니다. 다시 확인해 주세요.');
return;
}
const c = Utilities.base64EncodeWebSafe(JSON.stringify({
u: url,
k: key
}), Utilities.Charset.UTF_8).replace(/=+$/, '');
const links = [];
if (CFG.PAGE_URL) links.push({
label: '앱 링크 (GitHub)',
href: CFG.PAGE_URL + '#c=' + c
});
links.push({
label: CFG.PAGE_URL ? '예비 링크 (GitHub가 안 열릴 때)' : '앱 링크',
href: url + '?c=' + c
});
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const html = '<div style="font:14px/1.5 Arial,sans-serif;color:#1f2937">' + '<p>이 링크를 카카오톡으로 보내서 휴대폰에서 여세요.<br>링크에 팀 코드가 들어 있으니 <b>팀 밖으로는 보내지 마세요.</b></p>' + links.map(((l, i) => '<p style="margin:14px 0 4px"><b>' + esc(l.label) + '</b></p>' + '<textarea id="t' + i + '" readonly style="width:100%;height:64px;font:12px monospace">' + esc(l.href) + '</textarea>' + '<button onclick="var t=document.getElementById(\'t' + i + '\');t.select();document.execCommand(\'copy\');this.textContent=\'복사됨 ✓\'" ' + 'style="margin-top:4px;padding:6px 14px">복사</button>')).join('') + '</div>';
ui.showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(CFG.PAGE_URL ? 380 : 240), '휴대폰 연결 링크');
}

function formatSheet_(sh) {
const L = c => colLetter(c);
sh.getRange(1, 1, 1, HEAD.length).setValues([ HEAD ]).setFontWeight('bold').setBackground(COLOR.head).setFontColor(COLOR.headInk).setHorizontalAlignment('center');
sh.setFrozenRows(1);
const widths = {
TIME: 130,
SITE: 150,
NAME: 200,
LINK: 100,
IMG: 70,
QTY: 70,
RCV: 80,
TEL: 120,
ADDR: 260,
BY: 80,
STATUS: 80,
MEMO: 220,
ID: 90
};
Object.keys(widths).forEach((k => sh.setColumnWidth(COL[k], widths[k])));
sh.getRange(L(COL.TIME) + '2:' + L(COL.TIME)).setNumberFormat('yyyy-mm-dd hh:mm');
sh.getRange(L(COL.TEL) + '2:' + L(COL.TEL)).setNumberFormat('@');
[ COL.QTY, COL.BY, COL.STATUS ].forEach((c => sh.getRange(L(c) + '2:' + L(c)).setHorizontalAlignment('center')));
sh.hideColumns(COL.ID);
const st = sh.getRange(L(COL.STATUS) + '2:' + L(COL.STATUS));
st.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build());
const data = sh.getRange('A2:' + L(HEAD.length));
sh.setConditionalFormatRules([ SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + L(COL.STATUS) + '2="입고완료"').setFontColor(COLOR.doneInk).setBackground(COLOR.done).setRanges([ data ]).build(), SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('요청').setBackground(COLOR.req).setFontColor(COLOR.reqInk).setBold(true).setRanges([ st ]).build(), SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('주문완료').setBackground(COLOR.ord).setFontColor(COLOR.ordInk).setBold(true).setRanges([ st ]).build() ]);
}

function coupangSearchUrl(name) {
return 'https://www.coupang.com/np/search?q=' + encodeURIComponent(String(name || '').trim());
}

function isSearchUrl(url) {
return /coupang\.com\/np\/search/.test(String(url || ''));
}

function extractUrl(text) {
const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/);
return m ? m[0].replace(/[),.\]]+$/, '') : '';
}

function linkLabel(url) {
return /coupang\.com/.test(url) ? '쿠팡 상품' : '상품 링크';
}

function linkFormula(url, label) {
const q = s => String(s).replace(/"/g, '""');
return '=HYPERLINK("' + q(String(url).replace(/"/g, '%22')) + '","' + q(label) + '")';
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

function safeText(s) {
s = String(s == null ? '' : s);
return /^[=+@]/.test(s) ? '\'' + s : s;
}

function clip_(s, n) {
return String(s == null ? '' : s).replace(/[\u0000-\u0009\u000b-\u001f]/g, '').trim().slice(0, n);
}

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
link: ''
};
if (requireName && !out.name) return {
error: '품명을 적어주세요'
};
if (src.link) {
const u = extractUrl(clip_(src.link, LIMIT.link));
if (!u) return {
error: '링크는 https:// 로 시작하는 주소여야 합니다'
};
out.link = u;
}
return out;
}

function rowToItem(v, linkFormulaText, id, imgFormulaText) {
const t = v[COL.TIME - 1];
const time = t instanceof Date ? t.getTime() : t ? Date.parse(String(t).replace(' ', 'T')) || 0 : 0;
const name = String(v[COL.NAME - 1]).trim();
let link = urlFromFormula(linkFormulaText) || extractUrl(String(v[COL.LINK - 1]));
const custom = !!link && !isSearchUrl(link);
if (!link) link = coupangSearchUrl(name);
return {
id: id || String(v[COL.ID - 1]),
t: time,
site: String(v[COL.SITE - 1]).trim(),
name: name,
link: link,
custom: custom,
qty: String(v[COL.QTY - 1]).trim(),
by: String(v[COL.BY - 1]).trim(),
status: normalizeStatus(v[COL.STATUS - 1]) || String(v[COL.STATUS - 1]).trim(),
memo: String(v[COL.MEMO - 1]).trim(),
rcv: String(v[COL.RCV - 1]).trim(),
tel: normalizePhone(v[COL.TEL - 1]),
addr: String(v[COL.ADDR - 1] == null ? '' : v[COL.ADDR - 1]).trim(),
img: imageFromFormula(imgFormulaText) || (/^https?:\/\//.test(String(v[COL.IMG - 1] || '')) ? String(v[COL.IMG - 1]) : '')
};
}

function colLetter(c) {
let s = '';
while (c > 0) {
const m = (c - 1) % 26;
s = String.fromCharCode(65 + m) + s;
c = Math.floor((c - 1) / 26);
}
return s;
}

function imageFormula(url) {
return '=IMAGE("' + String(url).replace(/"/g, '%22') + '")';
}

function imageFromFormula(f) {
const m = String(f || '').match(/^=\s*IMAGE\(\s*"([^"]*)"/i);
return m ? m[1] : '';
}

function ogImage(html) {
html = String(html || '');
let m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
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

function normalizePhone(s) {
const raw = String(s == null ? '' : s).trim();
let d = raw.replace(/[^0-9]/g, '');
if (!d) return raw;
if (/^1[016789]\d{7,8}$/.test(d)) d = '0' + d;
if (/^01[016789]\d{7,8}$/.test(d)) return d.slice(0, 3) + '-' + d.slice(3, d.length - 4) + '-' + d.slice(-4);
if (/^02\d{7,8}$/.test(d)) return '02-' + d.slice(2, d.length - 4) + '-' + d.slice(-4);
if (/^0\d{9,10}$/.test(d)) return d.slice(0, 3) + '-' + d.slice(3, d.length - 4) + '-' + d.slice(-4);
return raw;
}

if (typeof module !== 'undefined') {
module.exports = {
coupangSearchUrl: coupangSearchUrl,
isSearchUrl: isSearchUrl,
extractUrl: extractUrl,
linkFormula: linkFormula,
urlFromFormula: urlFromFormula,
normalizeStatus: normalizeStatus,
safeText: safeText,
cleanInput: cleanInput,
rowToItem: rowToItem,
normalizePhone: normalizePhone,
ogImage: ogImage,
colLetter: colLetter
};
}
