// node test/e2e.js — 휴대폰 두 대(김철수·지역장)로 등록 → 실시간 반영 → 상태 변경을 확인
'use strict';
const assert = require('assert');
const { chromium, devices } = require('playwright');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const { server, env } = require('./serve').start(8787);
  const port = 8787;
  const c = Buffer.from(JSON.stringify({ u: `http://localhost:${port}/api`, k: 'testkey123' })).toString('base64url');
  const link = `http://localhost:${port}/#c=${c}`;
  // 이 컨테이너는 로캘이 없어서 한글 파일 이름이 'download'로 바뀐다 → UTF-8 지정
  const b = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const phone = devices['iPhone 13'];
  const errors = [];
  async function open(name, scheme) {
    const ctx = await b.newContext({ ...phone, colorScheme: scheme || 'light' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto(link);
    await p.fill('#nmIn', name);
    await p.click('#nmOk');
    await p.waitForTimeout(400);
    return p;
  }
  const a = await open('김철수');
  assert.equal(new URL(a.url()).hash, '', '연결 정보는 주소창에서 지운다');
  await a.screenshot({ path: path.join(OUT, '1_empty.png') });

  // 등록 (품명 칸을 누르면 나머지가 펼쳐진다)
  assert.equal(await a.isVisible('#addBtn'), false);
  await a.fill('#fName', '락스 4L');
  await a.screenshot({ path: path.join(OUT, '1b_form.png') });
  await a.click('#qPlus');
  await a.click('[data-unit="통"]');
  await a.fill('#fSite', '○○빌딩 3층');
  assert.match(await a.textContent('#cpreview'), /락스 4L/);
  await a.click('#addBtn');
  await a.waitForSelector('.item:not(.pending)');
  await a.fill('#fName', '물티슈');
  await a.click('#moreBtn');
  await a.fill('#fLink', '[쿠팡] 크리넥스 물티슈 https://link.coupang.com/a/bXyZ12');
  await a.fill('#fMemo', '향 없는 걸로');
  await a.click('#addBtn');
  await a.waitForFunction(() => document.querySelectorAll('.item:not(.pending)').length === 2);

  const sheet = await (await fetch(`http://localhost:${port}/__sheet`)).json();
  console.log('시트:', JSON.stringify(sheet, null, 0));
  assert.equal(sheet[1][2], '락스 4L'); assert.equal(sheet[1][4], '2통'); assert.equal(sheet[1][5], '김철수');
  assert.match(sheet[1][3], /^=HYPERLINK\("https:\/\/www\.coupang\.com\/np\/search\?q=/);
  assert.equal(sheet[2][3], '=HYPERLINK("https://link.coupang.com/a/bXyZ12","쿠팡 상품")');
  assert.equal(await a.locator('.item').first().locator('.cbtn').getAttribute('href'), 'https://link.coupang.com/a/bXyZ12');

  // 공유 문구를 통째로 붙여넣으면 품명·링크가 채워진다 (📋 붙여넣기 버튼)
  await a.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await a.evaluate(() => navigator.clipboard.writeText('[쿠팡] 유한락스 레귤러 4L https://link.coupang.com/a/LAKS01'));
  await a.click('#fName'); await a.click('#pasteBtn');
  await a.waitForFunction(() => document.querySelector('#fLink').value !== '');
  assert.equal(await a.inputValue('#fLink'), 'https://link.coupang.com/a/LAKS01');
  assert.equal(await a.inputValue('#fName'), '유한락스 레귤러 4L');
  await a.screenshot({ path: path.join(OUT, '10_paste_form.png') });
  await a.click('#addCancel');

  // 지역장 폰: 열자마자 보인다
  const m = await open('박지역장', 'dark');
  await m.waitForFunction(() => document.querySelectorAll('.item').length === 2);
  await m.waitForTimeout(2800);
  await m.screenshot({ path: path.join(OUT, '3_manager_dark.png') });

  // 지역장이 하나 추가 → 김철수 폰에 15초 안에 뜬다
  await m.fill('#fName', '종량제 봉투 100L');
  await m.click('#addBtn');
  await m.waitForFunction(() => document.querySelectorAll('.item:not(.pending)').length === 3);
  await a.waitForFunction(() => document.querySelectorAll('.item').length === 3, null, { timeout: 25000 });
  assert.match(await a.locator('.item').first().textContent(), /NEW/);
  assert.match(await a.textContent('.dhead'), /^오늘 · \d+월 \d+일 \([일월화수목금토]\) 3건$/);
  await a.screenshot({ path: path.join(OUT, '2_list.png'), fullPage: true });

  // 검색 링크만 있는 항목에 '링크 붙이기' → 상품 링크로 바뀌고 시트에도
  await a.evaluate(() => navigator.clipboard.writeText('쿠팡 https://link.coupang.com/a/BAG100'));
  await a.click('.item:has-text("종량제") [data-paste]');
  await a.waitForFunction(() => /BAG100/.test(document.querySelector('.item .cbtn').getAttribute('href') || ''), null, { timeout: 10000 });
  await a.waitForTimeout(500);
  const sh3 = await (await fetch(`http://localhost:${port}/__sheet`)).json();
  assert.ok(sh3.some((r) => r[3] === '=HYPERLINK("https://link.coupang.com/a/BAG100","쿠팡 상품")'), '시트에 상품 링크');
  await a.screenshot({ path: path.join(OUT, '11_item_linked.png') });

  // 지역장이 '주문했어요' → 김철수 폰 '주문함' 탭으로 옮겨감
  await m.click('.item:has-text("락스") .next');
  await m.waitForTimeout(600);
  await a.waitForFunction(() => !document.querySelector('#items').textContent.includes('락스'), null, { timeout: 25000 });
  await a.click('[data-tab="주문완료"]');
  assert.match(await a.textContent('#items'), /락스 4L/);
  assert.equal((await (await fetch(`http://localhost:${port}/__sheet`)).json())[1][6], '주문완료');

  // 고치기 창
  await a.click('.item:has-text("락스") .nm');
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, '4_edit.png') });
  assert.ok(await a.isVisible('#eSave'), '저장 버튼이 화면 안에 보여야 한다');
  await a.fill('#eMemo', '2개만 먼저');
  await a.click('#eSave');
  await a.waitForTimeout(800);
  assert.equal((await (await fetch(`http://localhost:${port}/__sheet`)).json())[1][7], '2개만 먼저');

  // 삭제
  a.on('dialog', (d) => d.accept());
  await a.click('[data-tab=""]');
  await a.click('.item:has-text("종량제") .nm');
  await a.waitForTimeout(300);
  await a.click('#eDel');
  await a.waitForTimeout(800);
  const after = await (await fetch(`http://localhost:${port}/__sheet`)).json();
  assert.equal(after.length, 3);

  // 엑셀 내보내기: 오래된 입고완료 한 줄을 시트에 직접 넣고, 이번 달 / 전체 를 비교
  const sh = env.sheets['청소용품'];
  sh.getRange(sh.getLastRow() + 1, 1, 1, 9).setValues([[new Date(2026, 5, 3, 9, 5), '△△센터', '옛날 락스', '', '3통', '김철수', '입고완료', '메모 <&> "따옴표"', 'old1']]);
  await a.click('#xlsxBtn');
  await a.waitForFunction(() => /엑셀 파일 받기 \(2건\)/.test(document.querySelector('#xGo').textContent));
  await a.screenshot({ path: path.join(OUT, '6_export.png') });
  await a.click('#xPer [data-v="all"]');
  assert.match(await a.textContent('#xGo'), /3건/);
  const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#xGo')]);
  const xfile = path.join(OUT, 'export.xlsx');
  await dl.saveAs(xfile);
  console.log('파일 이름:', dl.suggestedFilename());
  assert.match(dl.suggestedFilename(), /^청소용품_전체_\d{4}-\d\d-\d\d\.xlsx$/);
  const py = require('child_process').execFileSync('python3', ['-c', `
import openpyxl, json, sys
ws = openpyxl.load_workbook(sys.argv[1]).active
print(json.dumps([[c.value if not hasattr(c.value, 'isoformat') else c.value.isoformat() for c in r] for r in ws.iter_rows()], ensure_ascii=False))
print(ws.freeze_panes, ws.auto_filter.ref, ws['A2'].number_format)
`, xfile]).toString().trim().split('\n');
  console.log(py.join('\n'));
  const rows = JSON.parse(py[0]);
  assert.deepEqual(rows[0], ['등록일시', '현장', '품명', '수량', '상태', '등록자', '메모', '쿠팡']);
  assert.equal(rows.length, 4);
  assert.equal(rows[1][2], '옛날 락스'); // 오래된 것부터
  assert.equal(rows[1][0], '2026-06-03T09:05:00');
  assert.equal(rows[1][6], '메모 <&> "따옴표"');
  assert.match(rows[1][7], /^=HYPERLINK\("https:\/\/www\.coupang\.com\/np\/search\?q=/);
  assert.ok(rows.some((r) => r[7] === '=HYPERLINK("https://link.coupang.com/a/bXyZ12","쿠팡 상품")'));
  assert.equal(py[1], 'A2 A1:H4 yyyy-mm-dd hh:mm');
  await a.click('#xCancel');
  await a.waitForTimeout(300);

  // 월별 합계: 이번 달 3건 (6월 것은 빠짐), 지난달로 넘기면 0건, 6월로 가면 1건
  await a.click('[data-view="month"]');
  await a.waitForSelector('#monthView .tile');
  await a.waitForTimeout(800);
  const tiles = await a.$$eval('#monthView .tile b', (els) => els.map((e) => e.textContent));
  console.log('이번 달 타일:', tiles.join(' / '));
  assert.deepEqual(tiles, ['2', '1', '0', '1']); // 락스(주문완료) + 물티슈(요청). 종량제는 지웠다
  const rowsM = await a.$$eval('#monthView .rows:nth-of-type(1) .rrow, #monthView h3 + .rows .rrow', (els) => els.map((e) => e.textContent));
  console.log('품목별:', rowsM.join(' | '));
  assert.ok(rowsM.some((t) => /락스 4L\s*1번\s*2통/.test(t)), '품목별에 락스 4L 1번 2통');
  await a.screenshot({ path: path.join(OUT, '12_month.png'), fullPage: true });
  for (let i = 0; i < 5; i++) { await a.click('[data-mon="-1"]'); }
  assert.match(await a.textContent('#monthView .mnav b'), /2026년 6월/);
  assert.match(await a.textContent('#monthView'), /옛날 락스/);
  assert.match(await a.textContent('#monthView'), /3통/);
  // 6월 엑셀 → 기간이 '직접'(6/1~6/30)로 열리고 1건, 두 번째 시트에 품목별 합계
  await a.click('#mXlsxGo');
  await a.waitForFunction(() => /1건/.test(document.querySelector('#xGo').textContent));
  assert.equal(await a.inputValue('#xFrom'), '2026-06-01'); assert.equal(await a.inputValue('#xTo'), '2026-06-30');
  const [dl2] = await Promise.all([a.waitForEvent('download'), a.click('#xGo')]);
  const x2 = path.join(OUT, 'export_june.xlsx'); await dl2.saveAs(x2);
  console.log('파일 이름:', dl2.suggestedFilename());
  const py2 = require('child_process').execFileSync('python3', ['-c', `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1])
print(json.dumps({n: [[c.value for c in r] for r in wb[n].iter_rows()] for n in wb.sheetnames}, ensure_ascii=False, default=str))
`, x2]).toString();
  const wb2 = JSON.parse(py2);
  console.log(JSON.stringify(wb2['품목별 합계']));
  assert.deepEqual(Object.keys(wb2), ['목록', '품목별 합계']);
  assert.equal(wb2['목록'].length, 2);
  assert.deepEqual(wb2['품목별 합계'][1].slice(0, 6), ['옛날 락스', 1, '3통', 0, 0, 1]);
  await a.click('#xCancel');
  await a.waitForTimeout(300);
  // 날짜 누르면 그날 목록으로
  for (let i = 0; i < 5; i++) { await a.click('[data-mon="1"]'); }
  await a.click('#monthView [data-day]');
  await a.waitForTimeout(400);
  assert.equal(await a.isVisible('#items'), true);
  assert.equal(await a.getAttribute('[data-view="list"]', 'aria-pressed'), 'true');

  // 설정 메뉴
  await a.click('#menuBtn');
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, '5_menu.png') });

  // ── 휴대폰만으로 처음 설치 (아무것도 없는 서버) ──────────────
  const inst = require('./serve').start(8788, { standalone: true });
  const ictx = await b.newContext({ ...phone, permissions: ['clipboard-read', 'clipboard-write'] });
  const ip = await ictx.newPage();
  ip.on('pageerror', (e) => errors.push('설치: ' + e.message));
  await ip.goto('http://localhost:8788/');
  await ip.screenshot({ path: path.join(OUT, '7_welcome.png') });
  await ip.click('#goInstall');
  await ip.waitForTimeout(500);
  await ip.click('#copyCode');
  await ip.waitForSelector('#copyOk:not(:empty)');
  const copied = await ip.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.includes('function doPost(e)') && copied.includes('function init_('), 'Code.gs 전체가 복사돼야 한다');
  await ip.screenshot({ path: path.join(OUT, '8_install.png'), fullPage: true });
  // 잘못된 주소
  await ip.fill('#instUrl', 'https://script.google.com/macros/s/abc/dev');
  await ip.click('#instGo');
  assert.match(await ip.textContent('#instErr'), /dev 주소/);
  // 붙여넣기 버튼 → 설치
  await ip.evaluate(() => navigator.clipboard.writeText('웹 앱 URL http://localhost:8788/api'));
  await ip.fill('#instUrl', '');
  await ip.click('#instPaste');
  await ip.waitForFunction(() => document.querySelector('#instUrl').value !== '');
  assert.equal(await ip.inputValue('#instUrl'), 'http://localhost:8788/api');
  await ip.click('#instGo');
  await ip.waitForSelector('#st5:not([hidden])');
  assert.equal(await ip.getAttribute('#instSheet', 'href'), 'https://docs.google.com/spreadsheets/d/SSID/edit');
  await ip.screenshot({ path: path.join(OUT, '9_installed.png') });
  assert.ok(inst.env.props.TEAM_KEY);
  // 같은 주소로 남이 다시 설치하면 거절
  const other = await (await b.newContext(phone)).newPage();
  await other.goto('http://localhost:8788/');
  await other.click('#goInstall');
  await other.fill('#instUrl', 'http://localhost:8788/api');
  await other.click('#instGo');
  await other.waitForSelector('#instErr:not(:empty)');
  assert.match(await other.textContent('#instErr'), /이미 설치된 주소/);
  // 앱 시작 → 등록 → 새 시트에 들어감
  await ip.click('#instStart');
  await ip.fill('#nmIn', '김철수'); await ip.click('#nmOk'); await ip.waitForTimeout(300);
  await ip.fill('#fName', '쓰레기봉투');
  await ip.click('#addBtn');
  await ip.waitForSelector('.item:not(.pending)');
  assert.equal(inst.env.sheets['청소용품'].peek(2, 3).v, '쓰레기봉투');
  // 메뉴의 '구글 시트 열기'
  await ip.click('#menuBtn');
  await ip.waitForFunction(() => document.querySelector('#mSheet').getAttribute('href') !== '#');
  inst.server.close();

  assert.deepEqual(errors, []);
  console.log('e2e 통과');
  await b.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
