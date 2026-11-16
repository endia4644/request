// node test/make_icons.js — icon.svg 로 PNG 아이콘 생성
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch();
  const raw = fs.readFileSync(path.join(__dirname, '..', 'icon.svg'), 'utf8');
  for (const s of [180, 512]) {
    const svg = s === 180 ? raw.replace(/rx="112"/, "rx=\"0\"") : raw; // 아이폰은 모서리를 직접 둥글게 깎는다
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent(`<style>*{margin:0}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`);
    await p.screenshot({ path: path.join(__dirname, '..', `icon-${s}.png`), omitBackground: true });
  }
  await b.close();
})();
