// 앱 아이콘 만들기: icon-src.jpg(정사각형 원본) → icon-512.png · icon-180.png(아이폰) · favicon.png
//   node test/make_icons.js   (ImageMagick convert 필요. -strip 으로 사진 정보(EXIF) 제거)
// 2026-11-16 아이콘 = 지역장님 햄버거 요정 사진 (본인 허락 받음 — 사용자 확인)
const { execFileSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const src = path.join(root, 'icon-src.jpg');
for (const [name, size] of [['icon-512.png', 512], ['icon-180.png', 180], ['favicon.png', 64]]) {
  execFileSync('convert', [src, '-strip', '-resize', `${size}x${size}`, path.join(root, name)]);
  console.log(name, size);
}
