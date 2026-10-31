// Small TOML reader for `init --client codex`. It parses the whole file (so a broken
// config is detected and left alone) and records where each table header and key/value
// statement sits, so `init` can replace just the `[mcp_servers.<name>]` table and its
// subtables textually and keep every other byte, comment included. It is not a full
// TOML 1.0 validator (dates are kept as strings, some redefinition rules are relaxed),
// but anything it accepts is structurally sound and it rejects malformed input.

import { ConfigParseError } from './jsonc.js';

export type TomlTable = { [key: string]: unknown };

export interface TomlHeader {
  path: string[];
  array: boolean;
  start: number; // offset of the first character of the header line
}

export interface TomlStatement {
  table: string[]; // path of the table the statement belongs to
  key: string[]; // dotted key, relative to that table
  headerIndex: number; // index into headers, -1 for the root table
  end: number; // offset just past the statement's line break
}

export interface TomlDocument {
  data: TomlTable;
  headers: TomlHeader[];
  statements: TomlStatement[];
}

const BARE_KEY = /^[A-Za-z0-9_-]+/;
const DATETIME =
  /^(\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(\.\d+)?)/;
const NUMBER =
  /^([+-]?(inf|nan)|0x[0-9A-Fa-f](_?[0-9A-Fa-f])*|0o[0-7](_?[0-7])*|0b[01](_?[01])*|[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?)/;

const isTable = (v: unknown): v is TomlTable => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseToml(t: string): TomlDocument {
  let i = 0;
  const fail = (msg: string): never => {
    const line = t.slice(0, i).split('\n').length;
    throw new ConfigParseError(`line ${line}: ${msg}`);
  };

  const skipWs = () => {
    while (t[i] === ' ' || t[i] === '\t') i++;
  };
  const skipComment = () => {
    if (t[i] === '#') while (i < t.length && t[i] !== '\n') i++;
  };
  const skipBlank = () => {
    for (;;) {
      skipWs();
      skipComment();
      if (t[i] === '\n') i++;
      else if (t[i] === '\r' && t[i + 1] === '\n') i += 2;
      else return;
    }
  };
  const endOfLine = () => {
    skipWs();
    skipComment();
    if (i >= t.length) return;
    if (t[i] === '\n') i++;
    else if (t[i] === '\r' && t[i + 1] === '\n') i += 2;
    else fail(`unexpected "${t[i]}"`);
  };

  const basicString = (multi: boolean): string => {
    let out = '';
    for (;;) {
      if (i >= t.length) fail('unterminated string');
      const ch = t[i];
      if (multi && t.startsWith('"""', i)) {
        // The closing delimiter is the last three quotes of the run ("""a"""" is a + ").
        let run = 0;
        while (t[i + run] === '"') run++;
        if (run > 5) fail('too many quotes');
        i += run;
        return out + '"'.repeat(run - 3);
      }
      if (!multi && ch === '"') {
        i++;
        return out;
      }
      if (!multi && ch === '\n') fail('newline in string');
      if (ch === '\\') {
        const e = t[i + 1];
        const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', e: '\x1b', '"': '"', '\\': '\\' };
        if (e in simple) {
          out += simple[e];
          i += 2;
        } else if (e === 'u' || e === 'U') {
          const len = e === 'u' ? 4 : 8;
          const hex = t.slice(i + 2, i + 2 + len);
          if (!new RegExp(`^[0-9A-Fa-f]{${len}}$`).test(hex)) fail('bad unicode escape');
          out += String.fromCodePoint(parseInt(hex, 16));
          i += 2 + len;
        } else if (multi && /^\\[ \t]*\r?\n/.test(t.slice(i))) {
          i++;
          while (/[ \t\r\n]/.test(t[i] ?? '')) i++;
        } else {
          fail('bad escape');
        }
        continue;
      }
      out += ch;
      i++;
    }
  };

  const literalString = (multi: boolean): string => {
    const close = multi ? "'''" : "'";
    const end = t.indexOf(close, i);
    if (end === -1) fail('unterminated string');
    let s = t.slice(i, end);
    if (!multi && s.includes('\n')) fail('newline in string');
    i = end;
    if (multi) {
      let run = 0;
      while (t[i + run] === "'") run++;
      if (run > 5) fail('too many quotes');
      s += "'".repeat(run - 3);
      i += run;
    } else {
      i++;
    }
    return s;
  };

  const string = (): string => {
    if (t.startsWith('"""', i)) {
      i += 3;
      if (t[i] === '\n') i++;
      else if (t.startsWith('\r\n', i)) i += 2;
      return basicString(true);
    }
    if (t.startsWith("'''", i)) {
      i += 3;
      if (t[i] === '\n') i++;
      else if (t.startsWith('\r\n', i)) i += 2;
      return literalString(true);
    }
    if (t[i] === '"') {
      i++;
      return basicString(false);
    }
    i++;
    return literalString(false);
  };

  const keyPart = (): string => {
    skipWs();
    if (t[i] === '"' || t[i] === "'") {
      if (t.startsWith('"""', i) || t.startsWith("'''", i)) fail('multi-line key');
      return string();
    }
    const m = BARE_KEY.exec(t.slice(i));
    if (!m) fail('expected a key');
    i += m![0].length;
    return m![0];
  };

  const dottedKey = (): string[] => {
    const parts = [keyPart()];
    skipWs();
    while (t[i] === '.') {
      i++;
      parts.push(keyPart());
      skipWs();
    }
    return parts;
  };

  const assign = (table: TomlTable, key: string[], value: unknown) => {
    let cur = table;
    for (const part of key.slice(0, -1)) {
      if (!(part in cur)) cur[part] = {};
      const next = cur[part];
      if (!isTable(next)) fail(`key "${part}" is already a value`);
      cur = next as TomlTable;
    }
    const last = key[key.length - 1];
    if (last in cur) fail(`duplicate key "${key.join('.')}"`);
    cur[last] = value;
  };

  const value = (): unknown => {
    const ch = t[i];
    if (ch === '"' || ch === "'") return string();
    if (ch === '[') {
      i++;
      const arr: unknown[] = [];
      for (;;) {
        skipBlank();
        if (t[i] === ']') {
          i++;
          return arr;
        }
        arr.push(value());
        skipBlank();
        if (t[i] === ',') i++;
        else if (t[i] !== ']') fail('expected "," or "]" in array');
      }
    }
    if (ch === '{') {
      i++;
      const obj: TomlTable = {};
      skipWs();
      if (t[i] === '}') {
        i++;
        return obj;
      }
      for (;;) {
        const key = dottedKey();
        if (t[i] !== '=') fail('expected "=" in inline table');
        i++;
        skipWs();
        assign(obj, key, value());
        skipWs();
        if (t[i] === ',') {
          i++;
          skipWs();
        } else if (t[i] === '}') {
          i++;
          return obj;
        } else fail('expected "," or "}" in inline table');
      }
    }
    const rest = t.slice(i, i + 64);
    if (rest.startsWith('true')) {
      i += 4;
      return true;
    }
    if (rest.startsWith('false')) {
      i += 5;
      return false;
    }
    const dt = DATETIME.exec(rest);
    if (dt && (dt[0].length > 4 || dt[0].includes(':'))) {
      i += dt[0].length;
      return dt[0];
    }
    const num = NUMBER.exec(rest);
    if (num) {
      i += num[0].length;
      const raw = num[0].replace(/_/g, '');
      return /^0[xob]/.test(raw) ? Number(raw) : Number(raw.replace(/^\+/, '').replace(/inf$/, 'Infinity').replace(/^-?nan$/, 'NaN'));
    }
    return fail('invalid value');
  };

  const data: TomlTable = {};
  const headers: TomlHeader[] = [];
  const statements: TomlStatement[] = [];
  const definedTables = new Set<string>();
  let current = data;
  let currentPath: string[] = [];

  if (t.charCodeAt(0) === 0xfeff) i = 1;
  for (;;) {
    skipBlank();
    if (i >= t.length) break;
    if (t[i] === '[') {
      const start = i;
      const array = t[i + 1] === '[';
      i += array ? 2 : 1;
      const path = dottedKey();
      if (array ? !t.startsWith(']]', i) : t[i] !== ']') fail('unterminated table header');
      i += array ? 2 : 1;
      endOfLine();
      let cur = data;
      for (const [n, part] of path.entries()) {
        const isLast = n === path.length - 1;
        if (isLast && array) {
          if (!(part in cur)) cur[part] = [];
          const arr = cur[part];
          if (!Array.isArray(arr)) fail(`"${path.join('.')}" is not an array of tables`);
          const tbl: TomlTable = {};
          (arr as unknown[]).push(tbl);
          cur = tbl;
          break;
        }
        if (!(part in cur)) cur[part] = {};
        let next = cur[part];
        if (Array.isArray(next)) next = next[next.length - 1];
        if (!isTable(next)) fail(`"${path.join('.')}" collides with a value`);
        cur = next as TomlTable;
      }
      if (!array) {
        const id = JSON.stringify(path);
        if (definedTables.has(id)) fail(`table [${path.join('.')}] defined twice`);
        definedTables.add(id);
      }
      headers.push({ path, array, start });
      current = cur;
      currentPath = path;
      continue;
    }
    const key = dottedKey();
    if (t[i] !== '=') fail('expected "="');
    i++;
    skipWs();
    assign(current, key, value());
    endOfLine();
    statements.push({ table: currentPath, key, headerIndex: headers.length - 1, end: i });
  }
  return { data, headers, statements };
}

/** Render a flat MCP server entry (strings, string arrays, string maps) as a TOML table. */
export function renderTomlTable(path: string[], entry: Record<string, unknown>, eol: string): string {
  const key = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));
  const val = (v: unknown): string => {
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return `[${v.map(val).join(', ')}]`;
    if (isTable(v)) return `{ ${Object.entries(v).map(([k, x]) => `${key(k)} = ${val(x)}`).join(', ')} }`;
    throw new Error(`cannot render ${typeof v} as TOML`);
  };
  const lines = [`[${path.map(key).join('.')}]`, ...Object.entries(entry).map(([k, v]) => `${key(k)} = ${val(v)}`)];
  return lines.join(eol) + eol;
}
