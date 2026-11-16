// Apps Script 가짜 환경 — Code.gs 를 node 에서 그대로 돌리기 위한 것.
// 데이터 다루는 메서드만 진짜로 흉내 내고, 서식 메서드는 아무 일도 안 하고 자기 자신을 돌려준다.
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

function noop() {
  const p = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : () => p), apply: () => p });
  return p;
}

function a1(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
  const col = (s) => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  return { c0: col(m[1]), r0: +m[2] || 1, c1: col(m[3] || m[1]), r1: m[4] ? +m[4] : (m[3] ? 1000 : +m[2] || 1) };
}

class Sheet {
  constructor(name) { this.name = name; this.cells = []; }
  getName() { return this.name; }
  cell(r, c) { this.cells[r] = this.cells[r] || []; return this.cells[r][c] = this.cells[r][c] || { v: '', f: '' }; }
  peek(r, c) { return (this.cells[r] && this.cells[r][c]) || { v: '', f: '' }; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 1; r--) {
      const row = this.cells[r];
      if (row && row.some((x) => x && (x.v !== '' || x.f))) return r;
    }
    return 0;
  }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') { const q = a1(r); return new Range(this, q.r0, q.c0, q.r1 - q.r0 + 1, q.c1 - q.c0 + 1); }
    return new Range(this, r, c, nr || 1, nc || 1);
  }
  deleteRow(r) { this.cells.splice(r, 1); }
  setFrozenRows() {} setColumnWidth() {} hideColumns() {} setConditionalFormatRules() {}
}

function evalFormula(f) {
  const m = f.match(/^=HYPERLINK\("(?:[^"]|"")*","((?:[^"]|"")*)"\)$/);
  return m ? m[1].replace(/""/g, '"') : '#FORMULA';
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); return new Proxy(this, { get: (t, k) => (k in t ? t[k] : noop()) }); }
  each(fn) { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(fn(this.r + i, this.c + j)); out.push(row); } return out; }
  getValues() { return this.each((r, c) => this.sh.peek(r, c).v); }
  getFormulas() { return this.each((r, c) => this.sh.peek(r, c).f); }
  getValue() { return this.getValues()[0][0]; }
  getFormula() { return this.getFormulas()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues 크기 불일치');
    this.each((r, c) => {
      let v = vals[r - this.r][c - this.c];
      const cell = this.sh.cell(r, c);
      if (typeof v === 'string' && v.startsWith('=')) { cell.f = v; cell.v = evalFormula(v); return; }
      if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
      cell.v = v; cell.f = '';
    });
    return this;
  }
  setFormula(f) { const cell = this.sh.cell(this.r, this.c); cell.f = f; cell.v = evalFormula(f); return this; }
  clearContent() { this.each((r, c) => { const x = this.sh.cell(r, c); x.v = ''; x.f = ''; }); return this; }
  getRow() { return this.r; } getColumn() { return this.c; } getNumRows() { return this.nr; } getNumColumns() { return this.nc; }
  getSheet() { return this.sh; }
}

function makeEnv() {
  const sheets = {};
  const props = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new Sheet(n)),
    setSpreadsheetTimeZone() {},
  };
  const ctx = {
    console, Date, JSON, Math, String, Number, Object, Array, RegExp, encodeURIComponent, decodeURIComponent, parseInt, isNaN,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss, flush() {}, newDataValidation: noop, newConditionalFormatRule: noop,
      getUi: noop,
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => crypto.randomUUID(), base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url'), Charset: {} },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
    HtmlService: {
      createHtmlOutputFromFile: () => ({ kind: 'html', setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }),
      XFrameOptionsMode: {},
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return { ctx, ss, sheets, props };
}

module.exports = { makeEnv };
