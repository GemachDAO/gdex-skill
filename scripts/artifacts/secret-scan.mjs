// Release secret scan for packed npm artifacts. Used by tests/artifacts/root-package.test.mjs;
// also runnable by hand:  node scripts/artifacts/secret-scan.mjs <extracted-package-dir>
//
// Flags, in every text file of the package:
//   - 0x + 64 hex (EVM private-key shape). Esbuild bundles vendor third-party crypto libraries
//     whose curve constants and EIP-712 type hashes have the same shape, so a hit inside a
//     bundle is accepted only when the identical literal exists in a dependency under
//     node_modules (proving it is vendored code, not a key we wrote). First-party files get no
//     such allowance.
//   - 12+ consecutive BIP-39 English words (seed-phrase shape), plus any 12/24-word window
//     that passes the BIP-39 checksum. Strictly alphabetical runs (an embedded wordlist) are skipped.
//   - PEM private keys and well-known token prefixes (GitHub, npm, Anthropic, OpenAI, AWS, Slack).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(REPO, 'package.json'));

const HEX64 = /(?<![0-9a-fA-Fx])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;
const TOKEN_PATTERNS = [
  ['pem-private-key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/g],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
];
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|gz|tgz|zip|wasm|pdf)$/i;
// Files that are esbuild bundles of third-party code (relative to the package root).
const DEFAULT_BUNDLES = ['mcp-server/dist/index.js', 'dist/index.js'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (!BINARY_EXT.test(name)) out.push(p);
  }
  return out;
}

let bip39 = null;
function bip39Tools() {
  if (!bip39) {
    const { wordlists, Mnemonic } = require('ethers');
    const en = wordlists.en;
    const words = new Set();
    for (let i = 0; i < 2048; i++) words.add(en.getWord(i));
    bip39 = { words, isValid: (phrase) => Mnemonic.isValidMnemonic(phrase, en) };
  }
  return bip39;
}

function scanMnemonics(text) {
  const { words, isValid } = bip39Tools();
  const hits = [];
  // Runs of lowercase words separated by single spaces/newlines (seed phrases are written that way).
  const re = /[a-z]{3,8}(?:[ \t\n]+[a-z]{3,8}){11,}/g;
  for (const m of text.matchAll(re)) {
    const tokens = m[0].split(/\s+/);
    let run = [];
    const flush = () => {
      // A strictly ascending run is an embedded BIP-39 wordlist (e.g. vendored by ethers), not a phrase.
      const sorted = run.every((w, i) => i === 0 || run[i - 1] < w);
      if (run.length >= 12 && !sorted) {
        const phrase = run.join(' ');
        let checksum = false;
        for (const n of [24, 12]) {
          for (let i = 0; i + n <= run.length && !checksum; i++) checksum = isValid(run.slice(i, i + n).join(' '));
        }
        hits.push({ kind: checksum ? 'bip39-mnemonic-valid' : 'bip39-word-run', match: phrase.slice(0, 80) });
      }
      run = [];
    };
    for (const t of tokens) {
      if (words.has(t)) run.push(t);
      else flush();
    }
    flush();
  }
  return hits;
}

/** Returns the subset of `literals` that occur verbatim somewhere under the repo's node_modules. */
function vendoredLiterals(literals) {
  if (literals.length === 0) return new Set();
  const roots = [join(REPO, 'node_modules'), join(REPO, 'mcp-server', 'node_modules')].filter((p) => {
    try { return statSync(p).isDirectory(); } catch { return false; }
  });
  if (roots.length === 0) return new Set();
  let out = '';
  try {
    out = execFileSync('grep', ['-rhoF', '--include=*.js', '--include=*.cjs', '--include=*.mjs', ...literals.flatMap((l) => ['-e', l]), ...roots], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    out = e.stdout ?? ''; // grep exits 1 when nothing matched
  }
  return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
}

/**
 * Scans an extracted package directory. Returns an array of findings
 * ({ file, kind, match }); empty means clean.
 */
export function scanPackageDir(pkgDir, { bundles = DEFAULT_BUNDLES } = {}) {
  const findings = [];
  const bundleHex = new Map(); // literal -> files
  for (const file of walk(pkgDir)) {
    const rel = relative(pkgDir, file).split('\\').join('/');
    const text = readFileSync(file, 'utf8');
    const isBundle = bundles.includes(rel);
    for (const m of text.matchAll(HEX64)) {
      if (isBundle) {
        const lit = m[0].toLowerCase();
        if (!bundleHex.has(lit)) bundleHex.set(lit, new Set());
        bundleHex.get(lit).add(rel);
      } else {
        findings.push({ file: rel, kind: 'hex64', match: m[0] });
      }
    }
    for (const [kind, re] of TOKEN_PATTERNS) {
      for (const m of text.matchAll(re)) findings.push({ file: rel, kind, match: `${m[0].slice(0, 12)}...` });
    }
    for (const h of scanMnemonics(text)) findings.push({ file: rel, ...h });
  }
  if (bundleHex.size) {
    // Vendor code may spell constants in either case; compare case-insensitively.
    const vendored = new Set([...vendoredLiterals([...bundleHex.keys()]), ...vendoredLiterals([...bundleHex.keys()].map((l) => `0x${l.slice(2).toUpperCase()}`))].map((s) => s.toLowerCase()));
    for (const [lit, files] of bundleHex) {
      if (!vendored.has(lit)) for (const f of files) findings.push({ file: f, kind: 'hex64-not-vendored', match: lit });
    }
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/artifacts/secret-scan.mjs <extracted-package-dir>');
    process.exit(2);
  }
  const findings = scanPackageDir(resolve(dir));
  for (const f of findings) console.log(`${f.kind}\t${f.file}\t${f.match}`);
  console.log(findings.length ? `${findings.length} finding(s)` : 'clean');
  process.exit(findings.length ? 1 : 0);
}
