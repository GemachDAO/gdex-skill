// Minimal JSON / JSONC helpers for `init`: parse a client config (optionally allowing
// comments and trailing commas, as VS Code's mcp.json does) and splice one member into
// an object *textually*, so comments, key order and formatting elsewhere in the file
// survive. Only ever run on text that already parsed successfully.

export class ConfigParseError extends Error {}

function skipTrivia(t: string, i: number, comments: boolean): number {
  for (;;) {
    while (i < t.length && (t[i] === ' ' || t[i] === '\t' || t[i] === '\n' || t[i] === '\r')) i++;
    if (comments && t.startsWith('//', i)) {
      const nl = t.indexOf('\n', i);
      i = nl === -1 ? t.length : nl + 1;
      continue;
    }
    if (comments && t.startsWith('/*', i)) {
      const end = t.indexOf('*/', i + 2);
      if (end === -1) throw new ConfigParseError('unterminated /* comment');
      i = end + 2;
      continue;
    }
    return i;
  }
}

function scanString(t: string, i: number): number {
  // t[i] === '"'; returns the index just past the closing quote.
  for (let j = i + 1; j < t.length; j++) {
    if (t[j] === '\\') j++;
    else if (t[j] === '"') return j + 1;
  }
  throw new ConfigParseError('unterminated string');
}

/** Strip comments and trailing commas so the text can go through JSON.parse. */
export function stripJsonc(t: string): string {
  let out = '';
  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (ch === '"') {
      const end = scanString(t, i);
      out += t.slice(i, end);
      i = end;
    } else if (t.startsWith('//', i) || t.startsWith('/*', i)) {
      i = skipTrivia(t, i, true);
      out += ' ';
    } else if (ch === ',') {
      const next = skipTrivia(t, i + 1, true);
      if (t[next] !== '}' && t[next] !== ']') out += ',';
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

export function parseJsonConfig(t: string, comments: boolean): unknown {
  try {
    return JSON.parse(comments ? stripJsonc(t) : t);
  } catch (err) {
    throw new ConfigParseError(err instanceof Error ? err.message : String(err));
  }
}

interface Member {
  key: string;
  valueStart: number;
  valueEnd: number;
}

function scanValue(t: string, i: number, comments: boolean): number {
  const ch = t[i];
  if (ch === '"') return scanString(t, i);
  if (ch === '{') return objectMembers(t, i, comments).close + 1;
  if (ch === '[') {
    let j = skipTrivia(t, i + 1, comments);
    while (t[j] !== ']') {
      if (j >= t.length) throw new ConfigParseError('unterminated array');
      j = skipTrivia(t, scanValue(t, j, comments), comments);
      if (t[j] === ',') j = skipTrivia(t, j + 1, comments);
    }
    return j + 1;
  }
  const m = /^[^\s,\]}/]+/.exec(t.slice(i));
  if (!m) throw new ConfigParseError(`unexpected character at offset ${i}`);
  return i + m[0].length;
}

function objectMembers(t: string, open: number, comments: boolean): { members: Member[]; close: number } {
  const members: Member[] = [];
  let i = skipTrivia(t, open + 1, comments);
  while (t[i] !== '}') {
    if (t[i] !== '"') throw new ConfigParseError(`expected a key at offset ${i}`);
    const keyEnd = scanString(t, i);
    const key = JSON.parse(t.slice(i, keyEnd)) as string;
    i = skipTrivia(t, keyEnd, comments);
    if (t[i] !== ':') throw new ConfigParseError(`expected ':' at offset ${i}`);
    const valueStart = skipTrivia(t, i + 1, comments);
    const valueEnd = scanValue(t, valueStart, comments);
    members.push({ key, valueStart, valueEnd });
    i = skipTrivia(t, valueEnd, comments);
    if (t[i] === ',') i = skipTrivia(t, i + 1, comments);
  }
  return { members, close: i };
}

function lineIndent(t: string, pos: number): string {
  const lineStart = t.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(t.slice(lineStart))![0];
}

function detectIndentUnit(t: string): string {
  const m = /\n([ \t]+)\S/.exec(t);
  return m ? m[1] : '  ';
}

/**
 * Set `root[containerKey][name] = value` by editing the text in place. The container
 * object is created if missing. Duplicate keys resolve to the last one, matching JSON.parse.
 */
export function setJsonMember(
  t: string,
  containerKey: string,
  name: string,
  value: unknown,
  comments: boolean,
  eol: string,
): string {
  const unit = detectIndentUnit(t);
  const render = (v: unknown, indent: string) =>
    JSON.stringify(v, null, unit).replace(/\n/g, eol + indent);

  const insertMember = (text: string, open: number, key: string, v: unknown): string => {
    const { members } = objectMembers(text, open, comments);
    const outer = lineIndent(text, open);
    const inner = outer + unit;
    const member = `${JSON.stringify(key)}: ${render(v, inner)}`;
    if (members.length > 0) {
      const at = members[members.length - 1].valueEnd;
      return `${text.slice(0, at)},${eol}${inner}${member}${text.slice(at)}`;
    }
    const { close } = objectMembers(text, open, comments);
    const body = text.slice(open + 1, close);
    const keep = body.trim() === '' ? '' : body.replace(/\s+$/, '');
    return `${text.slice(0, open + 1)}${keep}${eol}${inner}${member}${eol}${outer}${text.slice(close)}`;
  };

  const top = skipTrivia(t, 0, comments);
  if (t[top] !== '{') throw new ConfigParseError('top level is not an object');
  const container = objectMembers(t, top, comments).members.filter((m) => m.key === containerKey).pop();
  if (!container) return insertMember(t, top, containerKey, { [name]: value });
  if (t[container.valueStart] !== '{') throw new ConfigParseError(`"${containerKey}" is not an object`);

  const existing = objectMembers(t, container.valueStart, comments).members.filter((m) => m.key === name).pop();
  if (!existing) return insertMember(t, container.valueStart, name, value);
  const indent = lineIndent(t, existing.valueStart);
  return `${t.slice(0, existing.valueStart)}${render(value, indent)}${t.slice(existing.valueEnd)}`;
}
