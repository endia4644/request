// node test/test.js — Code.gs 를 가짜 시트로 돌려서 확인
'use strict';
const assert = require('assert');
const { makeEnv } = require('./fake_gas');

let n = 0;
function t(name, fn) { fn(); n++; console.log('✓', name); }

const env = makeEnv();
const g = env.ctx;
const K = 'k1';
const post = (o) => JSON.parse(g.doPost({ postData: { contents: JSON.stringify(Object.assign({ k: K }, o)) } }).content);
const list = () => JSON.parse(g.doGet({ parameter: { action: 'list', k: K } }).content);

t('설치 전에는 막는다', () => {
  const r = list();
  assert.equal(r.ok, false); assert.equal(r.code, 'NOINIT');
});
env.props.TEAM_KEY = K;

t('팀 코드가 틀리면 막는다', () => {
  const r = JSON.parse(g.doGet({ parameter: { action: 'list', k: 'nope' } }).content);
  assert.equal(r.ok, false); assert.equal(r.code, 'KEY');
});

t('주소만 열면 앱 화면', () => assert.equal(g.doGet({ parameter: {} }).kind, 'html'));

t('빈 목록', () => assert.deepEqual(list(), { ok: true, items: [], now: list().now }));

t('등록 → 품명 옆 칸에 쿠팡 검색 링크', () => {
  const r = post({ action: 'add', name: '락스 4L', qty: '2통', site: '○○빌딩', by: '김철수', memo: '향 없는 거' });
  assert.equal(r.ok, true);
  const sh = env.sheets['청소용품'];
  assert.equal(sh.peek(1, 3).v, '품명'); assert.equal(sh.peek(1, 4).v, '쿠팡');
  assert.equal(sh.peek(2, 3).v, '락스 4L');
  assert.equal(sh.peek(2, 4).f, '=HYPERLINK("https://www.coupang.com/np/search?q=%EB%9D%BD%EC%8A%A4%204L","쿠팡에서 찾기")');
  assert.equal(sh.peek(2, 9).v, '요청');
  assert.ok(sh.peek(2, 1).v instanceof Date);
  const it = list().items[0];
  assert.equal(it.name, '락스 4L'); assert.equal(it.qty, '2통'); assert.equal(it.custom, false);
  assert.equal(it.link, 'https://www.coupang.com/np/search?q=%EB%9D%BD%EC%8A%A4%204L');
});

t('쿠팡 공유 문구를 붙여넣으면 주소만 뽑아 상품 링크로', () => {
  const r = post({ action: 'add', name: '물티슈', link: '[쿠팡] 크리넥스 물티슈 100매 https://link.coupang.com/a/bXyZ12', by: '박지역장' });
  assert.equal(r.ok, true);
  const it = list().items.find((x) => x.name === '물티슈');
  assert.equal(it.link, 'https://link.coupang.com/a/bXyZ12'); assert.equal(it.custom, true);
  const sh = env.sheets['청소용품'];
  assert.equal(sh.peek(3, 4).f, '=HYPERLINK("https://link.coupang.com/a/bXyZ12","쿠팡 상품")');
});

t('품명 없으면 거절, 링크가 주소가 아니면 거절', () => {
  assert.equal(post({ action: 'add', name: '  ' }).ok, false);
  assert.equal(post({ action: 'add', name: 'x', link: '그냥 글자' }).ok, false);
});

t('= 로 시작하는 값은 수식이 되지 않는다', () => {
  post({ action: 'add', name: '=IMPORTXML("http://evil")', memo: '+1' });
  const sh = env.sheets['청소용품'];
  const row = sh.getLastRow();
  assert.equal(sh.peek(row, 3).f, ''); assert.equal(sh.peek(row, 3).v, '=IMPORTXML("http://evil")');
  assert.ok(sh.peek(row, 4).f.includes('%3DIMPORTXML(%22http'));
  const id = sh.peek(row, 11).v;
  post({ action: 'remove', id });
});

t('같은 cid 로 두 번 보내면 한 줄만', () => {
  const before = env.sheets['청소용품'].getLastRow();
  assert.equal(post({ action: 'add', cid: 'cabc123xyz', name: '고무장갑' }).ok, true);
  assert.equal(post({ action: 'add', cid: 'cabc123xyz', name: '고무장갑' }).dup, true);
  assert.equal(env.sheets['청소용품'].getLastRow(), before + 1);
  assert.equal(list().items.find((x) => x.name === '고무장갑').id, 'cabc123xyz');
});

t('상태 바꾸기', () => {
  assert.equal(post({ action: 'update', id: 'cabc123xyz', fields: { status: '주문완료' } }).ok, true);
  assert.equal(list().items.find((x) => x.id === 'cabc123xyz').status, '주문완료');
  assert.equal(post({ action: 'update', id: 'cabc123xyz', fields: { status: '아무거나' } }).ok, false);
  assert.equal(post({ action: 'update', id: 'nope', fields: { status: '요청' } }).code, 'GONE');
});

t('품명을 고치면 검색 링크도 따라간다, 상품 링크는 유지', () => {
  post({ action: 'update', id: 'cabc123xyz', fields: { name: '니트릴 장갑' } });
  let it = list().items.find((x) => x.id === 'cabc123xyz');
  assert.equal(it.link, g.coupangSearchUrl('니트릴 장갑'));
  const wet = list().items.find((x) => x.name === '물티슈');
  post({ action: 'update', id: wet.id, fields: { name: '물티슈 대용량' } });
  it = list().items.find((x) => x.id === wet.id);
  assert.equal(it.link, 'https://link.coupang.com/a/bXyZ12');
  post({ action: 'update', id: wet.id, fields: { link: '' } });
  it = list().items.find((x) => x.id === wet.id);
  assert.equal(it.custom, false); assert.equal(it.link, g.coupangSearchUrl('물티슈 대용량'));
});

t('삭제', () => {
  assert.equal(post({ action: 'remove', id: 'cabc123xyz' }).ok, true);
  assert.equal(list().items.some((x) => x.id === 'cabc123xyz'), false);
  assert.equal(post({ action: 'remove', id: 'cabc123xyz' }).gone, true);
});

t('시트에 손으로 품명을 적으면 onEdit 가 링크·ID·시각·상태를 채운다', () => {
  const sh = env.sheets['청소용품'];
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 3).setValue('쓰레기봉투 100L');
  g.onEdit({ range: sh.getRange(row, 3) });
  assert.equal(sh.peek(row, 4).f, g.linkFormula(g.coupangSearchUrl('쓰레기봉투 100L'), '쿠팡에서 찾기'));
  assert.ok(sh.peek(row, 11).v); assert.equal(sh.peek(row, 9).v, '요청'); assert.ok(sh.peek(row, 1).v instanceof Date);
  // 링크 칸에 주소를 붙여넣으면 상품 링크로
  sh.getRange(row, 4).setValue('https://www.coupang.com/vp/products/123?itemId=9');
  g.onEdit({ range: sh.getRange(row, 4) });
  assert.equal(sh.peek(row, 4).f, '=HYPERLINK("https://www.coupang.com/vp/products/123?itemId=9","쿠팡 상품")');
  // 품명을 지우면 검색 링크도 지운다, 상품 링크는 남긴다
  const row2 = row + 1;
  sh.getRange(row2, 3).setValue('밀대'); g.onEdit({ range: sh.getRange(row2, 3) });
  sh.getRange(row2, 3).setValue(''); g.onEdit({ range: sh.getRange(row2, 3) });
  assert.equal(sh.peek(row2, 4).f, '');
});

t('ID 없이 손으로 넣은 줄도 목록에 나오고 ID가 채워진다', () => {
  const sh = env.sheets['청소용품'];
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 11).setValues([['2026-11-15 09:30', '△△센터', '극세사 걸레', '', '10', '', '', '김철수', '주문', '', '']]);
  const it = list().items.find((x) => x.name === '극세사 걸레');
  assert.ok(it.id); assert.equal(it.status, '주문완료'); assert.equal(it.qty, '10');
  assert.equal(it.t, Date.parse('2026-11-15T09:30'));
  assert.equal(sh.peek(row, 11).v, it.id);
});

t('오래된 입고완료는 앱 목록에서 빠진다 (시트엔 남음)', () => {
  const sh = env.sheets['청소용품'];
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 11).setValues([[new Date(Date.now() - 100 * 864e5), '', '옛날 물건', '', '', '', '', '', '입고완료', '', 'old1']]);
  assert.equal(list().items.some((x) => x.id === 'old1'), false);
  assert.equal(sh.peek(row, 3).v, '옛날 물건');
});

t('수취인·연락처: 저장되고 수취인 목록에 쌓인다 (같은 현장·이름이면 번호만 고침)', () => {
  const r = post({ action: 'add', name: '윈덱스', qty: '2개', site: '△△센터', rcv: '홍길동', tel: '01012345678', by: '김철수' });
  assert.equal(r.ok, true);
  const sh = env.sheets['청소용품'];
  assert.equal(sh.peek(1, 6).v, '수취인'); assert.equal(sh.peek(1, 7).v, '연락처');
  assert.equal(sh.peek(r.row, 6).v, '홍길동'); assert.equal(sh.peek(r.row, 7).v, '010-1234-5678');
  const it = list().items.find((x) => x.id === r.id);
  assert.equal(it.rcv, '홍길동'); assert.equal(it.tel, '010-1234-5678');
  post({ action: 'add', name: '홈스타', site: '△△센터', rcv: '홍길동', tel: '010-9999-0000' });
  post({ action: 'add', name: '고무장갑', site: '□□점', rcv: '이영희', tel: '' });
  const c = JSON.parse(g.doGet({ parameter: { action: 'list', k: K, contacts: '1' } }).content).contacts;
  assert.deepEqual(c, [{ site: '△△센터', name: '홍길동', tel: '010-9999-0000' }, { site: '□□점', name: '이영희', tel: '' }]);
  assert.equal(list().contacts, undefined, 'contacts=1 일 때만 보낸다');
  post({ action: 'update', id: r.id, fields: { rcv: '박민수', tel: '02-123-4567' } });
  const it2 = list().items.find((x) => x.id === r.id);
  assert.equal(it2.rcv, '박민수'); assert.equal(it2.tel, '02-123-4567');
  assert.equal(env.sheets['수취인'].getLastRow(), 4);
  ['윈덱스', '홈스타', '고무장갑'].forEach((n) => post({ action: 'remove', id: list().items.find((x) => x.name === n).id }));
});

t('전화번호 정리', () => {
  assert.equal(g.normalizePhone('010 1234 5678'), '010-1234-5678');
  assert.equal(g.normalizePhone(1012345678), '010-1234-5678'); // 시트가 숫자로 바꿔 앞 0 이 잘린 것
  assert.equal(g.normalizePhone('0212345678'), '02-1234-5678');
  assert.equal(g.normalizePhone('031-123-4567'), '031-123-4567');
  assert.equal(g.normalizePhone(''), '');
  assert.equal(g.normalizePhone('내선 123'), '내선 123');
});

t('all=1 이면 오래된 입고완료도 나온다 (엑셀용)', () => {
  const r = JSON.parse(g.doGet({ parameter: { action: 'list', k: K, all: '1' } }).content);
  assert.equal(r.items.some((x) => x.id === 'old1'), true);
  assert.equal(JSON.parse(g.api(JSON.stringify({ action: 'list', k: K, all: 1 }))).items.some((x) => x.id === 'old1'), true);
});

t('최신이 위', () => {
  const its = list().items;
  for (let i = 1; i < its.length; i++) assert.ok(its[i - 1].t >= its[i].t);
});

t('순수 함수', () => {
  assert.equal(g.extractUrl('보세요 https://link.coupang.com/a/Q1w2E3).'), 'https://link.coupang.com/a/Q1w2E3');
  assert.equal(g.urlFromFormula('=HYPERLINK("https://a.com/?x=""y""","라벨")'), 'https://a.com/?x="y"');
  assert.equal(g.urlFromFormula(''), '');
  assert.equal(g.normalizeStatus(' 입고 '), '입고완료');
  assert.equal(g.safeText('@abc'), "'@abc");
  assert.equal(g.safeText('-3'), '-3');
});

t('잘못된 JSON', () => {
  const r = JSON.parse(g.doPost({ postData: { contents: '{oops' } }).content);
  assert.equal(r.ok, false);
});

// ── 휴대폰 설치 (시트에 붙지 않은 스크립트) ─────────────────────
{
  const e2 = makeEnv({ standalone: true });
  const g2 = e2.ctx;
  const post2 = (o) => JSON.parse(g2.doPost({ postData: { contents: JSON.stringify(o) } }).content);

  t('휴대폰 설치: init 이 스프레드시트·트리거·팀 코드를 만든다', () => {
    const r = post2({ action: 'init' });
    assert.equal(r.ok, true); assert.ok(r.k.length >= 8);
    assert.equal(r.sheetUrl, 'https://docs.google.com/spreadsheets/d/SSID/edit');
    assert.equal(e2.log.created, 1);
    assert.deepEqual(e2.log.triggers, ['onSheetEdit']);
    assert.ok(e2.sheets['청소용품']); assert.equal(e2.sheets['시트1'], undefined);
    assert.equal(e2.sheets['청소용품'].peek(1, 4).v, '쿠팡');
    assert.equal(e2.props.SHEET_ID, 'SSID');
  });

  t('휴대폰 설치: init 은 한 번만 (남이 다시 부르면 거절, 팀 코드를 알면 시트 주소)', () => {
    const r = post2({ action: 'init' });
    assert.equal(r.ok, false); assert.equal(r.code, 'INIT_DONE'); assert.equal(r.k, undefined);
    const again = post2({ action: 'init', k: e2.props.TEAM_KEY });
    assert.equal(again.ok, true); assert.equal(again.again, true);
    assert.equal(e2.log.created, 1);
  });

  t('휴대폰 설치: 등록하면 새로 만든 시트에 들어가고 시트를 다시 만들지 않는다', () => {
    const k = e2.props.TEAM_KEY;
    assert.equal(post2({ action: 'add', k, name: '락스' }).ok, true);
    assert.equal(e2.sheets['청소용품'].peek(2, 3).v, '락스');
    assert.equal(post2({ action: 'info', k }).sheetUrl, 'https://docs.google.com/spreadsheets/d/SSID/edit');
    assert.equal(e2.log.created, 1);
  });

  t('휴대폰 설치: 시트 수정 트리거(onSheetEdit)도 링크를 채운다', () => {
    const sh = e2.sheets['청소용품'];
    sh.getRange(3, 3).setValue('밀대');
    g2.onSheetEdit({ range: sh.getRange(3, 3) });
    assert.match(sh.peek(3, 4).f, /^=HYPERLINK\("https:\/\/www\.coupang\.com\/np\/search\?q=%EB%B0%80%EB%8C%80"/);
  });

  t('휴대폰 설치: 주소만 열면 GitHub에서 받은 화면 (캐시)', () => {
    assert.equal(g2.doGet({ parameter: {} }).kind, 'remote');
    assert.equal(e2.log.fetched, 1);
  });
}

// ── 옛 9열 시트(수취인 열 없음) → 자동으로 두 열 끼우기 ───────────
{
  const e3 = makeEnv();
  e3.props.TEAM_KEY = 'k3';
  const sh = e3.ss.insertSheet('청소용품');
  sh.getRange(1, 1, 1, 9).setValues([['등록일시', '현장', '품명', '쿠팡', '수량', '등록자', '상태', '메모', 'ID']]);
  sh.getRange(2, 1, 1, 9).setValues([[new Date(), '△△센터', '락스', '', '2통', '김철수', '주문완료', '메모', 'oldid1']]);
  const post3 = (o) => JSON.parse(e3.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ k: 'k3' }, o)) } }).content);
  t('옛 시트는 처음 쓸 때 수취인·연락처 열이 끼워지고 기존 줄은 그대로 읽힌다', () => {
    const it = post3({ action: 'list' }).items[0];
    assert.deepEqual([it.name, it.qty, it.by, it.status, it.memo, it.id, it.rcv], ['락스', '2통', '김철수', '주문완료', '메모', 'oldid1', '']);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => sh.peek(1, c).v), ['등록일시', '현장', '품명', '쿠팡', '수량', '수취인', '연락처', '등록자', '상태', '메모', 'ID']);
    post3({ action: 'list' });
    assert.equal(sh.peek(1, 6).v, '수취인'); // 두 번 끼우지 않는다
    assert.equal(sh.peek(1, 12).v, '');
  });
}

console.log(`\n${n}개 모두 통과`);
