// node test/e2e.js — 휴대폰 두 대(김철수·지역장)로 등록 → 실시간 반영 → 상태 변경을 확인
'use strict';
const assert = require('assert');
const { chromium, devices } = require('playwright');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'shots');
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const { server, env } = require('./serve');
  const port = server.address().port;
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
  assert.equal(await a.getAttribute('.item:nth-child(1) .cbtn', 'href'), 'https://link.coupang.com/a/bXyZ12');

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
  assert.match(await a.textContent('.item:nth-child(1)'), /NEW/);
  await a.screenshot({ path: path.join(OUT, '2_list.png'), fullPage: true });

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

  // 설정 메뉴
  await a.click('#menuBtn');
  await a.waitForTimeout(400);
  await a.screenshot({ path: path.join(OUT, '5_menu.png') });

  assert.deepEqual(errors, []);
  console.log('e2e 통과');
  await b.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
