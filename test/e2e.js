// node test/e2e.js — 휴대폰 두 대(김철수·지역장)로 등록 → 실시간 반영 → 상태 변경을 확인
'use strict';
const assert = require('assert');
const { chromium, devices } = require('playwright');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const { server, env } = require('./serve').start(8787);
  // 가짜 쿠팡: 상품 페이지에 og:image (실제 쿠팡은 막을 수 있다 — 실제 결과는 사용자 화면으로 확인)
  env.fetch = (url) => (/coupang\.com/.test(url) ? { code: 200, html: '<meta property="og:image" content="http://localhost:8787/icon-180.png">' } : null);
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
    assert.equal(await p.getAttribute('[data-view="site"]', 'aria-pressed'), 'true', '첫 화면은 현장별');
    await p.click('[data-view="list"]');
    await p.waitForTimeout(400);
    return p;
  }
  const a = await open('김철수');
  // 새 서버 + 수취인 명단 없음 → 맨 위에 명단 가져오기 안내
  await a.waitForSelector('#diagBox:not([hidden])', { timeout: 10000 });
  assert.match(await a.textContent('#diagBox'), /근무자 명단을 못 찾았어요/);
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
  assert.equal(sheet[1][2], '락스 4L'); assert.equal(sheet[1][5], '2통'); assert.equal(sheet[1][9], '김철수');
  assert.match(sheet[1][3], /^=HYPERLINK\("https:\/\/www\.coupang\.com\/np\/search\?q=/);
  assert.equal(sheet[2][3], '=HYPERLINK("https://link.coupang.com/a/bXyZ12","쿠팡 상품")');
  assert.equal(await a.locator('.item').first().locator('.cbtn').getAttribute('href'), 'https://link.coupang.com/a/bXyZ12');

  // 현장별 최근 발주 카드
  await a.click('[data-view="site"]');
  assert.match(await a.textContent('#siteView'), /○○빌딩 3층\s*2건[\s\S]*물티슈\s*1통[\s\S]*락스 4L\s*2통/);
  await a.click('[data-view="list"]');

  // 품목 자동완성: 초성 → 윈덱스, 고르면 단위까지 / 링크 있는 품목은 링크도
  await a.click('#fName');
  await a.fill('#fName', 'ㅇㄷㅅ');
  await a.waitForSelector('#fNameList:not([hidden])');
  assert.match(await a.textContent('#fNameList'), /윈덱스/);
  await a.screenshot({ path: path.join(OUT, '13_suggest.png') });
  await a.click('#fNameList button:has-text("윈덱스")');
  assert.equal(await a.inputValue('#fName'), '윈덱스');
  assert.equal(await a.isVisible('#fNameList'), false);
  await a.fill('#fName', '');
  await a.type('#fName', '양동');
  await a.click('#fNameList button:has-text("양동이")');
  assert.match(await a.inputValue('#fLink'), /^https:\/\/www\.coupang\.com\/vp\/products\/6675264657/);
  await a.fill('#fName', '');
  await a.type('#fName', '청소포');
  await a.click('#fNameList button:has-text("정전기 청소포")');
  assert.equal(await a.getAttribute('[data-unit="박스"]', 'aria-pressed'), 'true');
  // 현장 자동완성: 기록에서
  await a.click('#fSite'); await a.fill('#fSite', '');
  await a.type('#fSite', '빌딩');
  await a.click('#fSiteList button:has-text("○○빌딩 3층")');
  assert.equal(await a.inputValue('#fSite'), '○○빌딩 3층');
  await a.click('#addCancel');
  await a.click('[data-unit="통"]').catch(() => {});

  // 공유 문구를 통째로 붙여넣으면 품명·링크가 채워진다 (📋 붙여넣기 버튼)
  await a.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await a.evaluate(() => navigator.clipboard.writeText('[쿠팡] 유한락스 레귤러 4L https://link.coupang.com/a/LAKS01'));
  await a.click('#fName'); await a.click('#pasteBtn');
  await a.waitForFunction(() => document.querySelector('#fLink').value !== '');
  assert.equal(await a.inputValue('#fLink'), 'https://link.coupang.com/a/LAKS01');
  assert.equal(await a.inputValue('#fName'), '유한락스 레귤러 4L');
  await a.screenshot({ path: path.join(OUT, '10_paste_form.png') });
  await a.click('#addCancel');

  // 상품 링크가 있는 물티슈는 사진을 가져와 카드에 보여준다
  await a.waitForSelector('.item:has-text("물티슈") img.thumb', { timeout: 10000 });
  assert.equal(await a.getAttribute('.item:has-text("물티슈") img.thumb', 'src'), 'http://localhost:8787/icon-180.png');
  assert.equal((await (await fetch(`http://localhost:${port}/__sheet`)).json())[2][4], '=IMAGE("http://localhost:8787/icon-180.png")');

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
  assert.equal((await (await fetch(`http://localhost:${port}/__sheet`)).json())[1][10], '주문완료');

  // 고치기 창
  await a.click('.item:has-text("락스") .nm');
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, '4_edit.png') });
  assert.ok(await a.isVisible('#eSave'), '저장 버튼이 화면 안에 보여야 한다');
  await a.fill('#eMemo', '2개만 먼저');
  await a.click('#eSave');
  await a.waitForTimeout(800);
  assert.equal((await (await fetch(`http://localhost:${port}/__sheet`)).json())[1][11], '2개만 먼저');

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
  sh.getRange(sh.getLastRow() + 1, 1, 1, 13).setValues([[new Date(2026, 5, 3, 9, 5), '△△센터', '옛날 락스', '', '', '3통', '', '', '', '김철수', '입고완료', '메모 <&> "따옴표"', 'old1']]);
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
ws = openpyxl.load_workbook(sys.argv[1])['목록']
print(json.dumps([[c.value if not hasattr(c.value, 'isoformat') else c.value.isoformat() for c in r] for r in ws.iter_rows()], ensure_ascii=False))
print(ws.freeze_panes, ws.auto_filter.ref, ws['A2'].number_format)
print(json.dumps([[c.coordinate, c.hyperlink.target if c.hyperlink else None] for c in ws['K'][1:]]))
`, xfile]).toString().trim().split('\n');
  console.log(py.join('\n'));
  const rows = JSON.parse(py[0]);
  assert.deepEqual(rows[0], ['등록일시', '현장', '품명', '수량', '수취인', '연락처', '주소', '상태', '등록자', '메모', '쿠팡 링크']);
  assert.equal(rows.length, 4);
  assert.equal(rows[1][2], '옛날 락스'); // 오래된 것부터
  assert.equal(rows[1][0], '2026-06-03T09:05:00');
  assert.equal(rows[1][9], '메모 <&> "따옴표"');
  // 쿠팡 링크 = 주소 글자 그대로 + 진짜 하이퍼링크 (수식 아님)
  assert.match(rows[1][10], /^https:\/\/www\.coupang\.com\/np\/search\?q=/);
  assert.ok(rows.some((r) => r[10] === 'https://link.coupang.com/a/bXyZ12'));
  assert.ok(!rows.some((r) => String(r[10] || '').startsWith('=')), '수식이 없어야 한다');
  const links = JSON.parse(py[2]);
  assert.ok(links.every((l) => l[1] && /^https:\/\//.test(l[1])), '모든 쿠팡 칸이 하이퍼링크: ' + JSON.stringify(links));
  assert.ok(links.some((l) => l[1] === 'https://link.coupang.com/a/bXyZ12'));
  assert.equal(py[1], 'A2 A1:K4 yyyy-mm-dd hh:mm');
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
  assert.equal(wb2['목록'].length, 2);
  assert.deepEqual(Object.keys(wb2), ['6월', '목록', '품목별 합계']);
  assert.deepEqual(wb2['품목별 합계'][1].slice(0, 6), ['옛날 락스', 1, '3통', 0, 0, 1]);
  await a.click('#xCancel');
  await a.waitForTimeout(300);
  // 날짜 누르면 그날 목록으로
  for (let i = 0; i < 5; i++) { await a.click('[data-mon="1"]'); }
  await a.click('#monthView [data-day]');
  await a.waitForTimeout(400);
  assert.equal(await a.isVisible('#items'), true);
  assert.equal(await a.getAttribute('[data-view="list"]', 'aria-pressed'), 'true');

  // 수취인: 현장 고르면 이름 목록 → 이름 고르면 전화번호까지
  await a.click('#fName'); await a.fill('#fName', '홈스타');
  await a.fill('#fSite', ''); await a.type('#fSite', '△△');
  await a.click('#fSiteList button:has-text("△△센터")');
  await a.fill('#fRcv', ''); await a.fill('#fTel', '');
  await a.fill('#fRcv', '홍길동'); await a.fill('#fTel', '01055556666'); await a.fill('#fAddr', '서울시 ○○구 ○○로 7');
  await a.click('#addBtn');
  await a.waitForTimeout(1200);
  const sh5 = await (await fetch(`http://localhost:${port}/__sheet`)).json();
  const homestar = sh5.find((r) => r[2] === '홈스타');
  assert.deepEqual([homestar[1], homestar[6], homestar[7]], ['△△센터', '홍길동', '010-5555-6666']);
  // 다음 등록: 현장만 고르면 수취인·번호가 저절로
  await a.click('#fName'); await a.fill('#fName', '윈덱스');
  await a.fill('#fSite', ''); await a.fill('#fRcv', ''); await a.fill('#fTel', '');
  await a.type('#fSite', '△△');
  await a.click('#fSiteList button:has-text("△△센터")');
  assert.equal(await a.inputValue('#fRcv'), '홍길동');
  assert.equal(await a.inputValue('#fTel'), '010-5555-6666');
  assert.equal(await a.inputValue('#fAddr'), '서울시 ○○구 ○○로 7');
  // 주소 칸을 비우고 누르면 자주 쓴 주소 목록
  await a.fill('#fAddr', ''); await a.click('#fTel'); await a.click('#fAddr');
  await a.waitForSelector('#fAddrList:not([hidden])');
  assert.match(await a.textContent('#fAddrList'), /서울시 ○○구 ○○로 7\s*1번/);
  await a.click('#fAddrList button');
  assert.equal(await a.inputValue('#fAddr'), '서울시 ○○구 ○○로 7');
  // 수취인 칸을 누르면 그 현장 사람 목록 (수취인 탭에서도)
  await a.fill('#fRcv', '');
  await a.click('#fTel'); await a.click('#fRcv');
  await a.waitForSelector('#fRcvList:not([hidden])');
  assert.match(await a.textContent('#fRcvList'), /홍길동[\s\S]*010-5555-6666/);
  await a.screenshot({ path: path.join(OUT, '14_rcv.png') });
  await a.click('#fRcvList button:has-text("홍길동")');
  assert.equal(await a.inputValue('#fTel'), '010-5555-6666');
  await a.click('#addCancel');
  // ── 근무자 명단(수취인 탭) → 현장 드롭다운(구분별) → 성함 드롭다운 → 번호·주소 ──
  {
    const cs = env.sheets['수취인'];
    const last = cs.getLastRow();
    cs.getRange(1, 1, 1, 5).setValues([['구분', '현장', '이름', '전화번호', '주소']]);
    cs.getRange(last + 1, 1, 4, 5).setValues([
      ['가나 브랜드', '가나 브랜드 강남', '최가람', '010-1000-2000', ''],
      ['가나 브랜드', '가나 브랜드 강남', '한누리', '01030004000', '서울시 ○○구 가나로 1'],
      ['가나 브랜드', '가나 브랜드 홍대', '정다운', '010-5000-6000', ''],
      ['기타', '라마 성수', '윤바다', '010-7000-8000', ''],
    ]);
    await a.reload();
    await a.waitForSelector('#addForm:not([hidden])');
    await a.waitForTimeout(800);
    await a.click('#fName'); await a.fill('#fName', '고무장갑');
    await a.fill('#fSite', ''); await a.fill('#fRcv', ''); await a.fill('#fTel', ''); await a.fill('#fAddr', '');
    await a.click('.ddbtn[data-dd="site"]');
    await a.waitForSelector('#fSiteList:not([hidden])');
    const heads = await a.$$eval('#fSiteList .sh2', (els) => els.map((e) => e.textContent));
    console.log('현장 목록 묶음:', heads.join(' / '));
    assert.deepEqual(heads.slice(0, 2), ['최근 쓴 현장', '가나 브랜드']);
    assert.ok(heads.includes('기타'));
    await a.screenshot({ path: path.join(OUT, '17_site_dd.png') });
    await a.click('#fSiteList button:has-text("가나 브랜드 강남")');
    // 현장을 고르면 성함 목록이 바로 열린다 (그 현장 사람만)
    await a.waitForSelector('#fRcvList:not([hidden])');
    const names = await a.$$eval('#fRcvList button .sn', (els) => els.map((e) => e.textContent));
    console.log('성함 목록:', names.join(' / '));
    assert.equal(names.length, 2); assert.ok(names[0].startsWith('최가람') || names[0].startsWith('한누리'));
    await a.screenshot({ path: path.join(OUT, '18_name_dd.png') });
    await a.click('#fRcvList button:has-text("한누리")');
    assert.equal(await a.inputValue('#fTel'), '010-3000-4000');
    assert.equal(await a.inputValue('#fAddr'), '서울시 ○○구 가나로 1');
    // 명단에 없는 현장 → 안내
    await a.fill('#fSite', '없는현장'); await a.fill('#fRcv', '');
    await a.click('.ddbtn[data-dd="rcv"]');
    assert.match(await a.textContent('#fRcvList'), /없는현장 근무자가 명단에 없어요/);
    await a.click('#addCancel');
  }

  // 현장별 보기에 수취인 줄
  await a.click('[data-view="site"]');
  await a.waitForTimeout(300);
  assert.match(await a.textContent('#siteView'), /△△센터[\s\S]*수취인 홍길동 · 010-5555-6666[\s\S]*홈스타/);
  await a.screenshot({ path: path.join(OUT, '15_site.png'), fullPage: true });
  // 발주서 시트: 묶음·병합·수취인
  await a.click('#xlsxBtn');
  await a.waitForFunction(() => /엑셀 파일 받기/.test(document.querySelector('#xGo').textContent));
  const [dl3] = await Promise.all([a.waitForEvent('download'), a.click('#xGo')]);
  const x3 = path.join(OUT, 'export_order.xlsx'); await dl3.saveAs(x3);
  const py3 = require('child_process').execFileSync('python3', ['-c', `
import openpyxl, json, sys
ws = openpyxl.load_workbook(sys.argv[1]).worksheets[0]
assert ws.title == '11월', ws.title
print(json.dumps({'cells': {c.coordinate: c.value for r in ws.iter_rows() for c in r if c.value is not None}, 'merged': sorted(str(m) for m in ws.merged_cells.ranges), 'links': {c.coordinate: c.hyperlink.target for r in ws.iter_rows() for c in r if c.hyperlink}}, ensure_ascii=False))
`, x3]).toString();
  const os3 = JSON.parse(py3);
  console.log('발주서:', JSON.stringify(os3));
  assert.equal(os3.cells.B4, '현장명'); assert.equal(os3.cells.F4, '수취인 정보');
  // 발주서 링크 칸: 상품 링크만, 주소 그대로 + 하이퍼링크
  const prodLinkCell = Object.keys(os3.cells).find((k) => os3.cells[k] === 'https://link.coupang.com/a/bXyZ12');
  assert.ok(prodLinkCell, '발주서에 상품 주소 그대로');
  assert.equal(os3.links[prodLinkCell], 'https://link.coupang.com/a/bXyZ12');
  assert.ok(!Object.values(os3.cells).some((v) => String(v).startsWith('=HYPERLINK')));
  assert.ok(Object.values(os3.cells).includes('홍길동\n010-5555-6666\n서울시 ○○구 ○○로 7'));
  await a.click('#xCancel');

  // 설정 메뉴
  await a.click('#menuBtn');
  await a.waitForTimeout(400);
  assert.match(await a.textContent('#sheetBody'), /서버 코드\s*✅ 최신 \d{4}-\d\d-\d\d/);
  // 서버 주소 바꾸기: 같은 서버(팀 코드 맞음) 주소면 바뀐다
  await a.click('#mServer');
  await a.fill('#svUrl', 'http://localhost:8787/api?x=1');
  await a.click('#svGo');
  await a.waitForFunction(() => !document.querySelector('#sheet').classList.contains('on'));
  await a.click('#menuBtn');
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, '5_menu.png') });

  // 수취인이 생긴 뒤에는 안내가 사라진다
  assert.equal(await a.isVisible('#diagBox'), false);

  // ── 옛 서버 코드(thumb 모름) → 맨 위에 '옛 버전' 안내 ──
  {
    const oldSrv = require('./serve').start(8789);
    const realHandle = oldSrv.env.ctx.handle_;
    oldSrv.env.ctx.handle_ = (req) => (req.action === 'thumb' || req.action === 'version' ? { ok: false, error: '알 수 없는 요청: ' + req.action } : (() => { const r = realHandle(req); delete r.version; return r; })());
    const octx = await b.newContext(phone);
    const op = await octx.newPage();
    await op.goto(`http://localhost:8789/`);
    await op.evaluate(() => {
      localStorage.setItem('sup.cfg', JSON.stringify({ u: 'http://localhost:8789/api', k: 'testkey123' }));
      localStorage.setItem('sup.me', JSON.stringify('김철수'));
    });
    await op.reload();
    await op.waitForSelector('#diagBox:not([hidden])', { timeout: 10000 });
    assert.match(await op.textContent('#diagBox'), /서버 코드가 아직 옛 버전/);
    assert.match(await op.textContent('#diagBox'), /지금 서버: 버전 표시 없음[\s\S]*필요한 버전: \d{4}-\d\d-\d\d/);
    await op.screenshot({ path: path.join(OUT, '16_old_server.png') });
    await octx.close(); oldSrv.server.close();
  }

  // ── 앱에서 근무자 명단 올리기: 오션 .xls(=HTML 표) / .xlsx ──
  {
    const fs = require('fs');
    const up = require('./serve').start(8790);
    const uctx = await b.newContext(phone);
    const upage = await uctx.newPage();
    upage.on('pageerror', (e) => errors.push('명단: ' + e.message));
    await upage.goto('http://localhost:8790/');
    await upage.evaluate(() => {
      localStorage.setItem('sup.cfg', JSON.stringify({ u: 'http://localhost:8790/api', k: 'testkey123' }));
      localStorage.setItem('sup.me', JSON.stringify('김철수'));
    });
    await upage.reload();
    await upage.waitForSelector('#diagImport');
    // 가짜 오션 파일 (HTML 표, .xls 이름) — 실제 명단은 저장소에 넣지 않는다
    const html = '<html><body><table><tr><th>성명</th><th>부서</th><th>팀</th><th>직급</th><th>전화번호</th><th>ID</th></tr>' +
      '<tr><td>가나다</td><td>가나 브랜드</td><td>강남</td><td>-</td><td>010-1234-0001</td><td>a</td></tr>' +
      '<tr><td>라마바</td><td>가나 브랜드</td><td>강남</td><td>-</td><td>01012340002</td><td>b</td></tr>' +
      '<tr><td>사아자</td><td>다라 빌딩</td><td>평일</td><td>-</td><td>010-1234-0003</td><td>c</td></tr>' +
      '<tr><td>차카타</td><td>-</td><td>-</td><td>-</td><td>010-1234-0004</td><td>d</td></tr></table></body></html>';
    const xlsFile = path.join(OUT, '가짜_근무자.xls'); fs.writeFileSync(xlsFile, html);
    await upage.click('#diagImport');
    await upage.setInputFiles('#impFile', xlsFile);
    await upage.waitForFunction(() => !document.querySelector('#impGo').disabled);
    assert.match(await upage.textContent('#impInfo'), /4명 · 현장 3곳/);
    await upage.screenshot({ path: path.join(OUT, '19_import.png') });
    await upage.click('#impGo');
    await upage.waitForFunction(() => !document.querySelector('#sheet').classList.contains('on'), null, { timeout: 10000 });
    const c1 = up.env.sheets['수취인'];
    const got = []; for (let r = 2; r <= c1.getLastRow(); r++) got.push([2, 3, 4].map((c) => c1.peek(r, c).v).join('|'));
    console.log('올린 명단:', got.join(' / '));
    assert.deepEqual(got, ['가나 브랜드 강남|가나다|010-1234-0001', '가나 브랜드 강남|라마바|010-1234-0002', '다라 빌딩|사아자|010-1234-0003', '본사·관리|차카타|010-1234-0004']);
    await upage.waitForFunction(() => !document.querySelector('#diagBox') || document.querySelector('#diagBox').hidden, null, { timeout: 10000 });
    // .xlsx (구분 열 포함) 도 읽는다
    const xlsx = path.join(OUT, '가짜_명단.xlsx');
    require('child_process').execFileSync('python3', ['-c', `
import openpyxl, sys
wb = openpyxl.Workbook(); ws = wb.active; ws.title = '수취인'
ws.append(['구분', '현장', '이름', '전화번호', '주소'])
ws.append(['가나 묶음', '가나 브랜드 강남', '가나다', '010-1234-0001', ''])
ws.append(['기타', '마바 센터', '하하하', '010-9999-0001', '서울시 ○○로 5'])
wb.save(sys.argv[1])`, xlsx]);
    await upage.click('#menuBtn'); await upage.waitForTimeout(300);
    await upage.click('#mImport');
    await upage.setInputFiles('#impFile', xlsx);
    await upage.waitForFunction(() => !document.querySelector('#impGo').disabled);
    assert.match(await upage.textContent('#impInfo'), /2명 · 현장 2곳/);
    await upage.click('#impGo');
    await upage.waitForFunction(() => !document.querySelector('#sheet').classList.contains('on'), null, { timeout: 10000 });
    assert.equal(c1.peek(2, 1).v, '가나 묶음'); assert.equal(c1.peek(3, 5).v, '서울시 ○○로 5'); assert.equal(c1.getLastRow(), 3);
    // 시트에 직접 한 명 더 적고 ⋮ → 지금 새로고침 → 바로 반영
    c1.getRange(4, 1, 1, 5).setValues([['기타', '마바 센터', '새사람', '010-9999-0002', '']]);
    await upage.click('#menuBtn'); await upage.waitForTimeout(300);
    await upage.click('#mRefresh');
    await upage.waitForFunction(() => /근무자 3명 · 현장 2곳 불러왔어요/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    await uctx.close(); up.server.close();
  }

  // ── 서버 주소 이사: 옛 주소를 저장한 휴대폰이 새 주소로 옮겨 간다 (팀 코드 맞을 때만) ──
  {
    const mctx = await b.newContext(phone);
    await mctx.addInitScript(() => {
      window.SUPPLY_MOVED = { 'http://localhost:8787/old': 'http://localhost:8787/api', 'http://localhost:8787/api2': 'http://localhost:8787/api' };
    });
    const mp = await mctx.newPage();
    mp.on('pageerror', (e) => errors.push('이사: ' + e.message));
    await mp.goto(`http://localhost:${port}/`);
    await mp.evaluate(() => {
      localStorage.setItem('sup.cfg', JSON.stringify({ u: 'http://localhost:8787/old', k: 'testkey123' }));
      localStorage.setItem('sup.me', JSON.stringify('박지역장'));
    });
    await mp.reload();
    await mp.waitForFunction(() => JSON.parse(localStorage.getItem('sup.cfg')).u === 'http://localhost:8787/api', null, { timeout: 10000 });
    await mp.waitForSelector('#siteView .scard');
    // 팀 코드가 다르면 옮기지 않는다
    await mp.evaluate(() => localStorage.setItem('sup.cfg', JSON.stringify({ u: 'http://localhost:8787/api2', k: 'wrong' })));
    await mp.reload();
    await mp.waitForTimeout(1500);
    assert.equal(await mp.evaluate(() => JSON.parse(localStorage.getItem('sup.cfg')).u), 'http://localhost:8787/api2');
    await mctx.close();
  }

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
  await ip.click('[data-view="list"]');
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
