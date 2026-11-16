/* 청소용품 요청 서버 (붙여넣기용: 주석을 뺀 Code.gs). 원본 https://github.com/endia4644/request */
const CFG = {
SHEET: '청소용품',
PAGE_URL: 'https://endia4644.github.io/request/',
RAW_INDEX: 'https://raw.githubusercontent.com/endia4644/request/main/index.html',
SS_NAME: '청소용품 요청',
TZ: 'Asia/Seoul',
KEEP_DONE_DAYS: 90
};

const HEAD = [ '등록일시', '현장', '품명', '쿠팡', '수량', '등록자', '상태', '메모', 'ID' ];

const COL = {
TIME: 1,
SITE: 2,
NAME: 3,
LINK: 4,
QTY: 5,
BY: 6,
STATUS: 7,
MEMO: 8,
ID: 9
};

const STATUSES = [ '요청', '주문완료', '입고완료' ];

const LIMIT = {
name: 80,
site: 40,
qty: 20,
by: 20,
memo: 300,
link: 500
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
return listItems_(String(req.all || '') === '1');

case 'add':
return withLock_((() => addItem_(req)));

case 'update':
return withLock_((() => updateItem_(req)));

case 'remove':
return withLock_((() => removeItem_(req)));

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
return sh;
}

function readRows_(sh) {
const last = sh.getLastRow();
if (last < 2) return [];
const n = last - 1;
const rng = sh.getRange(2, 1, n, HEAD.length);
const values = rng.getValues();
const links = sh.getRange(2, COL.LINK, n, 1).getFormulas();
const out = [];
for (let i = 0; i < n; i++) {
out.push({
row: i + 2,
values: values[i],
linkFormula: links[i][0]
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
const it = rowToItem(r.values, r.linkFormula, id);
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
sh.getRange(row, 1, 1, HEAD.length).setValues([ [ now, safeText(it.site), safeText(it.name), '', safeText(it.qty), safeText(it.by), '요청', safeText(it.memo), id ] ]);
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
}
return {
ok: true
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
sh.getRange(1, 1, 1, HEAD.length).setValues([ HEAD ]).setFontWeight('bold').setBackground(COLOR.head).setFontColor(COLOR.headInk).setHorizontalAlignment('center');
sh.setFrozenRows(1);
const widths = [ 130, 120, 200, 110, 70, 80, 80, 220, 90 ];
widths.forEach(((w, i) => sh.setColumnWidth(i + 1, w)));
sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
sh.getRange('E2:G').setHorizontalAlignment('center');
sh.hideColumns(COL.ID);
sh.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(true).build());
const data = sh.getRange('A2:I');
const st = sh.getRange('G2:G');
sh.setConditionalFormatRules([ SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$G2="입고완료"').setFontColor(COLOR.doneInk).setBackground(COLOR.done).setRanges([ data ]).build(), SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('요청').setBackground(COLOR.req).setFontColor(COLOR.reqInk).setBold(true).setRanges([ st ]).build(), SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('주문완료').setBackground(COLOR.ord).setFontColor(COLOR.ordInk).setBold(true).setRanges([ st ]).build() ]);
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

function rowToItem(v, linkFormulaText, id) {
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
memo: String(v[COL.MEMO - 1]).trim()
};
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
rowToItem: rowToItem
};
}
