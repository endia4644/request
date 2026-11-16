// 휴대폰 붙여넣기용 Code.paste.gs 만들기 — 주석을 모두 뺀다.
//   휴대폰에서 붙여넣다 '//' 주석 끝 줄바꿈이 사라지면 다음 줄 코드가 주석에 먹혀 구문 오류가 난다 (2026-11-16 실제로 겪음).
//   주석이 없으면 그럴 일이 없다. 들여쓰기도 없앤다 — 복사하며 들여쓰기 공백이 '\' 로 바뀌는 일도 있었다 (같은 날). 동작은 Code.gs 와 같고, test/test.js 를 두 파일 모두로 돌린다.
// 실행: node tools/build_paste.js   (terser 가 없으면 npx 로 받아 온다)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'Code.gs');
const out = path.join(root, 'Code.paste.gs');
const opts = ['--format', 'beautify=true,comments=false,semicolons=true,indent_level=0,quote_style=1,max_line_len=false'];
const code = execFileSync('npx', ['-y', 'terser@5.31.0', src, ...opts], { encoding: 'utf8', maxBuffer: 1 << 26 });
const head = '/* 청소용품 요청 서버 (붙여넣기용: 주석을 뺀 Code.gs). 원본 https://github.com/endia4644/request */\n';
fs.writeFileSync(out, head + code);
console.log('Code.paste.gs', code.split('\n').length, '줄');
