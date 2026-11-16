// 개발용 서버: index.html 과 가짜 Apps Script(/api)를 한 포트에서 띄운다.
//   node test/serve.js [포트]   → http://localhost:8787/#c=...
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeEnv } = require('./fake_gas');

const DELAY = +process.env.DELAY || 150;

// opts.standalone: 휴대폰 설치처럼 아무것도 없는 상태에서 시작 (init 으로 설치)
function start(port, opts) {
opts = opts || {};
const env = makeEnv(opts);
if (!opts.standalone) {
  env.props.TEAM_KEY = 'testkey123';
  env.ctx.sheet_(); // 시트 만들기
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api') {
    const done = (out) => setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(out.content);
    }, DELAY);
    if (req.method === 'GET') return done(env.ctx.doGet({ parameter: Object.fromEntries(url.searchParams) }));
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => done(env.ctx.doPost({ postData: { contents: body } })));
    return;
  }
  if (url.pathname === '/__sheet') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const sh = env.sheets['청소용품'];
    const rows = [];
    for (let r = 1; r <= sh.getLastRow(); r++) rows.push([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => sh.peek(r, c).f || sh.peek(r, c).v));
    return res.end(JSON.stringify(rows));
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const p = path.join(__dirname, '..', path.normalize(file));
  if (!p.startsWith(path.join(__dirname, '..')) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  const type = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[path.extname(p)] || 'text/plain';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(p).pipe(res);
});
server.listen(port);
return { env, server };
}

if (require.main === module) {
  const port = +process.argv[2] || 8787;
  start(port, { standalone: process.env.STANDALONE === '1' });
  console.log('http://localhost:' + port + (process.env.STANDALONE === '1' ? '  (빈 상태 — 처음 설치부터)' : '  (팀 코드 testkey123)'));
}
module.exports = { start };
