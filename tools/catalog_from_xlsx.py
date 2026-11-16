"""평소 쓰는 발주 엑셀에서 '품목 · 링크 · 단위'만 뽑아 index.html 의 자동완성 목록(CATALOG)에 넣는다.

    python3 tools/catalog_from_xlsx.py 발주.xlsx [더.xlsx ...]

⚠️ 이 저장소는 공개다. 현장명·수취인·전화번호는 절대 뽑지 않는다 (품목 칸과 그 오른쪽 링크·수량만 읽음).
   원본 엑셀도 저장소에 넣지 말 것.
엑셀 형식: 어느 시트든 머리 줄에 '품목' 칸이 있으면, 그 오른쪽이 '링크', 그다음이 '수량'.
   (무신사 뷰티/스토어/스탠다드/기타처럼 옆으로 여러 묶음이어도 된다)
여러 파일을 주면 합친다. 이미 있는 목록에 더하려면 기존 것도 같이 준다는 생각 말고 그냥 다시 만든다 — 앱은 시트 기록의 품명도 자동완성에 섞는다.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / 'index.html'
UNIT_FIX = {'box': '박스', 'BOX': '박스', 'Box': '박스', 'ea': '개', 'EA': '개'}


def unit_of(q):
    m = re.match(r'^\s*\d+(?:\.\d+)?\s*(.*)$', str(q or ''))
    u = (m.group(1) if m else '').strip()
    return UNIT_FIX.get(u, u)


def items_from(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    for ws in wb.worksheets:
        heads = [(c.row, c.column) for row in ws.iter_rows() for c in row if str(c.value or '').strip() == '품목']
        for hr, hc in heads:
            for r in range(hr + 1, ws.max_row + 1):
                name = ws.cell(r, hc).value
                if name is None or not str(name).strip():
                    continue
                link = str(ws.cell(r, hc + 1).value or '').strip()
                yield {
                    'name': re.sub(r'\s+', ' ', str(name)).strip(),
                    'link': link if link.startswith('http') else '',
                    'unit': unit_of(ws.cell(r, hc + 2).value),
                }


def main(paths):
    seen = {}
    for p in paths:
        for it in items_from(p):
            key = it['name'].replace(' ', '').lower()
            cur = seen.get(key)
            if not cur:
                seen[key] = {'n': it['name'], 'l': it['link'], 'u': {it['unit']: 1} if it['unit'] else {}}
            else:
                if it['link'] and not cur['l']:
                    cur['l'] = it['link']
                if it['unit']:
                    cur['u'][it['unit']] = cur['u'].get(it['unit'], 0) + 1
    out = []
    for v in seen.values():
        e = {'n': v['n']}
        if v['l']:
            e['l'] = v['l']
        if v['u']:
            e['u'] = max(v['u'], key=v['u'].get)  # 가장 자주 쓴 단위
        out.append(e)
    out.sort(key=lambda e: e['n'])
    text = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    html = INDEX.read_text(encoding='utf-8')
    new, n = re.subn(r'/\*CATALOG\*/.*?/\*END\*/', lambda m: '/*CATALOG*/' + text + '/*END*/', html, flags=re.S)
    if n != 1:
        sys.exit('index.html 에 /*CATALOG*/…/*END*/ 자리가 없습니다')
    INDEX.write_text(new, encoding='utf-8')
    print(f'품목 {len(out)}개 (링크 {sum(1 for e in out if "l" in e)}개)')
    for e in out:
        print(' ', e['n'], '|', e.get('u', ''), '|', 'link' if 'l' in e else '')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
