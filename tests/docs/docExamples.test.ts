/**
 * Doc example checks (GDX-06): every SDK call shown to agents must exist.
 *
 * Sources: skills/*\/SKILL.md (also served by get_sdk_pattern / get_trading_guide /
 * explain_workflow), README.md, mcp-server/README.md and the hand-written
 * explain_workflow guides in mcp-server/src/workflowGuides.ts.
 *
 * 1. Every `skill.<method>(` / `sdk.<method>(` is a method on GdexSkill.prototype in dist/.
 * 2. Every TypeScript snippet that calls the SDK is type-checked against dist/index.d.ts;
 *    errors on the SDK call itself (unknown method, missing/unknown params, wrong
 *    argument types) fail. Snippet-local noise (undeclared placeholders, DOM/React
 *    globals, node types) is ignored.
 * 3. Backticked snake_case names in MCP-tool context are registered MCP tools.
 *
 * Needs a built SDK: run `npm run build` first.
 */
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { WORKFLOW_GUIDES } from '../../mcp-server/src/workflowGuides';

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'index.js');

interface Doc { file: string; text: string }

function loadDocs(): Doc[] {
  const docs: Doc[] = [];
  const skillsDir = path.join(ROOT, 'skills');
  for (const dir of fs.readdirSync(skillsDir).sort()) {
    const file = path.join(skillsDir, dir, 'SKILL.md');
    if (fs.existsSync(file)) docs.push({ file: `skills/${dir}/SKILL.md`, text: fs.readFileSync(file, 'utf8') });
  }
  for (const file of ['README.md', 'mcp-server/README.md']) {
    docs.push({ file, text: fs.readFileSync(path.join(ROOT, file), 'utf8') });
  }
  for (const [name, text] of Object.entries(WORKFLOW_GUIDES)) {
    docs.push({ file: `mcp-server/src/workflowGuides.ts#${name}`, text });
  }
  return docs;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function sdkMethods(): Set<string> {
  if (!fs.existsSync(DIST)) throw new Error('dist/index.js missing: run `npm run build` before this test');
  const { GdexSkill } = require(DIST) as { GdexSkill: { prototype: object } };
  const names = new Set<string>();
  for (let p: object | null = GdexSkill.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const n of Object.getOwnPropertyNames(p)) if (n !== 'constructor') names.add(n);
  }
  names.add('client'); // public readonly property; `skill.client.get(` is matched as `client.get`, not here
  return names;
}

function registeredTools(): Set<string> {
  const tools = new Set<string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts')) {
        for (const m of fs.readFileSync(full, 'utf8').matchAll(/\.tool\(\s*'([a-z0-9_]+)'/g)) tools.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, 'mcp-server', 'src'));
  return tools;
}

// ── Snippet type-check ──────────────────────────────────────────────────────

interface Snippet { id: string; file: string; line: number; src: string; offset: number }

/** Names agents conventionally carry between snippets; declared so shorthand params type-check. */
const PRELUDE_DECLS = [
  'declare const skill: __GdexSkill; declare const sdk: __GdexSkill;',
  'declare const apiKey: string, walletAddress: string, sessionPrivateKey: string, userId: string, data: string,',
  '  sessionKey: string, controlAddress: string, managedAddress: string, managedEvmAddress: string;',
  'declare const creds: { apiKey: string; walletAddress: string; sessionPrivateKey: string };',
].join('\n');

function extractSnippets(docs: Doc[]): Snippet[] {
  const out: Snippet[] = [];
  for (const doc of docs) {
    for (const m of doc.text.matchAll(/```(typescript|ts|tsx)\n([\s\S]*?)```/g)) {
      const body = m[2];
      if (!/\b(skill|sdk)\.\w+\s*\(/.test(body)) continue;
      const imports: string[] = [];
      const rest: string[] = [];
      let inImport = false;
      for (const l of body.split('\n')) {
        if (inImport || /^import\s/.test(l)) {
          imports.push(l);
          inImport = !/from\s+['"][^'"]+['"]/.test(l) && !/^import\s+['"]/.test(l);
        } else {
          rest.push(l.replace(/^export\s+(default\s+)?/, ''));
        }
      }
      const line = lineOf(doc.text, m.index ?? 0) + 1;
      const pre = `import type { GdexSkill as __GdexSkill } from '@gemachdao/gdex-skill';\n${imports.join('\n')}\n${PRELUDE_DECLS}\nexport {};\nasync function __snippet() {\n`;
      // React components are often fenced as ```typescript; parse anything with closing tags as TSX
      const ext = m[1] === 'tsx' || /<\/[A-Za-z]|\/>/.test(body) ? 'tsx' : 'ts';
      out.push({
        id: `/__doc_snippets__/${out.length}.${ext}`,
        file: doc.file,
        line,
        src: `${pre}${rest.join('\n')}\n}\n`,
        offset: pre.split('\n').length - 1,
      });
    }
  }
  return out;
}

/** Diagnostics that come from the snippet being a fragment, not from a wrong SDK call. */
const IGNORED_CODES = new Set([
  2304, 2552, // undeclared placeholder names
  18004, // shorthand property for an undeclared placeholder
  2580, 2591, // node globals (require/process) without @types/node
  2307, 2875, 7026, 2503, 2686, 2792, // react / jsx modules not installed
  18047, 18048, // "possibly undefined" on response fields: strictness, not API shape
]);

/**
 * Typed stand-ins for the React providers the UI skills define (gdex-ui-install-setup,
 * gdex-ui-wallet-connection), so `const { skill } = useGdex()` is a GdexSkill, not `any`.
 */
const PROVIDER_STUBS: Record<string, string> = {
  '@/providers/GdexProvider': [
    "import type { GdexSkill } from '@gemachdao/gdex-skill';",
    'export declare function useGdex(): { skill: GdexSkill; isReady: boolean; error: string | null };',
    'export declare function GdexProvider(props: { children?: unknown; apiKey: string }): unknown;',
  ].join('\n'),
  '@/providers/AuthProvider': [
    'export interface GdexCreds { apiKey: string; walletAddress: string; sessionPrivateKey: string }',
    'export declare function useAuth(): {',
    "  authMethod: 'none' | 'api-key' | 'wallet'; walletAddress: string | null; managedAddress: string | null;",
    '  creds: GdexCreds | null; isAuthenticated: boolean; loginWithApiKey: (key: string) => void;',
    '  loginWithWallet: (address: string, signFn: (msg: string) => Promise<string>) => Promise<void>; logout: () => void;',
    '};',
  ].join('\n'),
};

function typeCheckSnippets(snippets: Snippet[]): string[] {
  const files = new Map<string, Pick<Snippet, 'src'>>(snippets.map((s) => [s.id, s]));
  const stubPaths: Record<string, string[]> = {};
  Object.entries(PROVIDER_STUBS).forEach(([mod, src], i) => {
    const id = `/__doc_snippets__/stubs/provider${i}.d.ts`;
    files.set(id, { src });
    stubPaths[mod] = [id];
  });
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    baseUrl: ROOT,
    paths: { '@gemachdao/gdex-skill': ['dist/index.d.ts'], ...stubPaths },
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, lang, ...rest) => {
    const s = files.get(fileName);
    return s ? ts.createSourceFile(fileName, s.src, lang, true) : getSourceFile(fileName, lang, ...rest);
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => files.has(fileName) || fileExists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => files.get(fileName)?.src ?? readFile(fileName);

  const program = ts.createProgram(snippets.map((s) => s.id), options, host);
  const problems: string[] = [];
  for (const s of snippets) {
    const sf = program.getSourceFile(s.id);
    if (!sf) continue;
    const callSpans: Array<[number, number]> = [];
    const visit = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        ts.isIdentifier(n.expression.expression) && ['skill', 'sdk'].includes(n.expression.expression.text)
      ) callSpans.push([n.getStart(sf), n.getEnd()]);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (IGNORED_CODES.has(d.code) || d.start === undefined) continue;
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      if (d.code === 2339 && !/GdexSkill/.test(msg)) continue; // e.g. window.ethereum
      const start = d.start;
      if (!callSpans.some(([a, b]) => start >= a && start < b)) continue;
      const { line } = sf.getLineAndCharacterOfPosition(start);
      problems.push(`${s.file}:${s.line + line - s.offset} TS${d.code} ${msg}`);
    }
  }
  return problems;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('documentation examples', () => {
  const docs = loadDocs();

  it('loads every skill and the workflow guides', () => {
    expect(docs.filter((d) => d.file.startsWith('skills/')).length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(WORKFLOW_GUIDES)).toEqual(expect.arrayContaining(['spot-trade', 'perp-trade', 'auth']));
  });

  it('only calls real GdexSkill methods (skill.x( / sdk.x()', () => {
    const methods = sdkMethods();
    expect(methods.has('hlCreateOrder')).toBe(true);
    const unknown: string[] = [];
    for (const doc of docs) {
      for (const m of doc.text.matchAll(/\b(skill|sdk)\.([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!methods.has(m[2])) unknown.push(`${doc.file}:${lineOf(doc.text, m.index ?? 0)} ${m[1]}.${m[2]}()`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it('only names real SDK methods or exports in backticked calls like `hlCreateOrder()`', () => {
    const exported = new Set(Object.keys(require(DIST) as object));
    const methods = sdkMethods();
    // Functions the docs define themselves (React hooks/providers) or that are math, not SDK.
    const local = new Set(['useGdex', 'useAuth', 'loginWithWallet', 'calcGav', 'keccak256', 'ceil']);
    const unknown: string[] = [];
    for (const doc of docs) {
      for (const m of doc.text.matchAll(/`(?:skill\.|sdk\.)?([a-z][A-Za-z0-9]+)\([^`]*\)`/g)) {
        const name = m[1];
        if (!methods.has(name) && !exported.has(name) && !local.has(name)) {
          unknown.push(`${doc.file}:${lineOf(doc.text, m.index ?? 0)} ${m[0]}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('type-checks every SDK call in TypeScript snippets against the built SDK', () => {
    const snippets = extractSnippets(docs);
    expect(snippets.length).toBeGreaterThan(100);
    expect(typeCheckSnippets(snippets)).toEqual([]);
  }, 120_000);

  it('the snippet type-check catches a wrong call (self-test)', () => {
    const bad: Doc = {
      file: 'self-test.md',
      text: [
        '```typescript',
        "await skill.openPerpPosition({ coin: 'BTC' });",
        "await skill.perpDeposit({ amount: '10' });",
        '```',
      ].join('\n'),
    };
    const problems = typeCheckSnippets(extractSnippets([bad]));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/openPerpPosition/);
    expect(problems[1]).toMatch(/PerpDepositParams/);
  }, 120_000);

  it('only names registered MCP tools', () => {
    const tools = registeredTools();
    expect(tools.size).toBeGreaterThan(100);
    // Backend ABI/action names that share a line with tool names but are not tools.
    const notTools = new Set(['hl_create', 'hl_update']);
    const unknown: string[] = [];
    for (const doc of docs) {
      doc.text.split('\n').forEach((line, i) => {
        const names = [...line.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);
        if (names.length === 0) return;
        const toolContext = /\bMCP\b|\btools?\b/i.test(line) || names.some((n) => tools.has(n)) ||
          doc.file.startsWith('mcp-server/');
        if (!toolContext) return;
        for (const n of names) if (!tools.has(n) && !notTools.has(n)) unknown.push(`${doc.file}:${i + 1} \`${n}\``);
      });
    }
    expect(unknown).toEqual([]);
  });
});
