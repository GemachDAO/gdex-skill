#!/usr/bin/env node
/* GDEX agent-skill live demo — real calls, recorded for the reel. */
const fs = require('fs'), os = require('os'), path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const C = {
  reset: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[96m', green: '\x1b[92m', yellow: '\x1b[93m',
  red: '\x1b[91m', white: '\x1b[97m', mag: '\x1b[95m', blue: '\x1b[94m', gray: '\x1b[90m',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s = '') => process.stdout.write(s + '\n');
async function type(s, d = 14) { for (const ch of s) { process.stdout.write(ch); await sleep(d); } process.stdout.write('\n'); }
async function step(label) { process.stdout.write(`${C.gray}$ ${C.reset}${C.white}`); await type(label, 12); process.stdout.write(C.reset); await sleep(250); }
const ok = (s) => out(`  ${C.green}✓${C.reset} ${s}`);

const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY, ctrl = W.control.address, managed = '0x0405d2c012467cdf41b12010e15fa752e59fb40b';
const wallet = new ethers.Wallet(W.control.privateKey);

const BANNER = `${C.cyan}${C.b}
   ▄████  ▓█████▄ ▓█████ ▒██   ██▒
  ██▒ ▀█▒ ▒██▀ ██▌▓█   ▀ ▒▒ █ █ ▒░
 ▒██░▄▄▄░ ░██   █▌▒███   ░░  █   ░
 ░▓█  ██▓ ░▓█▄   ▌▒▓█  ▄  ░ █ █ ▒
 ░▒▓███▀▒ ░▒████▓ ░▒████▒▒██▒ ▒██▒
  ░▒   ▒   ▒▒▓  ▒ ░░ ▒░ ░▒▒ ░ ░▓ ░${C.reset}
${C.dim}        cross-chain trading skills for AI agents${C.reset}`;

(async () => {
  console.clear();
  out(BANNER);
  await sleep(700);
  out(`\n  ${C.dim}27 agent skills  ·  116 MCP tools  ·  Solana · HyperLiquid · 12 EVM chains${C.reset}`);
  await sleep(900);

  const s = new GdexSkill({ timeout: 45000, maxRetries: 1 });
  s.loginWithApiKey(apiKey);

  // ── 1. MARKET INTELLIGENCE ────────────────────────────────────────────────
  out(`\n${C.mag}${C.b}━━ 1 · MARKET INTELLIGENCE ${C.dim}(live HyperLiquid feed)${C.reset}\n`);
  await step('agent.getHlMetaAndAssetCtxs()  # funding · OI · price');
  const c = await s.getHlMetaAndAssetCtxs();
  const d = c?.data || c; const uni = d?.[0]?.universe; const st = d?.[1];
  out(`  ${C.gray}asset    price        24h      funding(APR)   open interest${C.reset}`);
  for (const sym of ['BTC', 'ETH', 'SOL', 'HYPE']) {
    const i = uni.findIndex((u) => u.name === sym); const a = st[i];
    const mark = Number(a.markPx), chg = ((mark - Number(a.prevDayPx)) / Number(a.prevDayPx)) * 100;
    const apr = (Number(a.funding) * 8760 * 100);
    const oi = (Number(a.openInterest) * mark / 1e6);
    const cc = chg >= 0 ? C.green : C.red;
    out(`  ${C.white}${C.b}${sym.padEnd(6)}${C.reset} $${mark.toLocaleString().padEnd(10)} ${cc}${(chg >= 0 ? '+' : '') + chg.toFixed(2)}%${C.reset}`.padEnd(46) + `  ${C.yellow}${apr.toFixed(1)}%${C.reset}        ${C.dim}$${oi.toFixed(0)}M${C.reset}`);
    await sleep(180);
  }
  await sleep(900);

  // ── 2. PREDICTION MARKETS ─────────────────────────────────────────────────
  out(`\n${C.mag}${C.b}━━ 2 · PREDICTION MARKETS ${C.dim}(HyperLiquid HIP-3 / HIP-4)${C.reset}\n`);
  await step('agent.getHlOutcomes({ status: "open" })');
  const o = await s.getHlOutcomes({ status: 'open' });
  const meta = o?.data?.meta || {}; const outs = meta.outcomes || []; const mids = o?.data?.mids || {};
  ok(`${C.b}${outs.length}${C.reset} live event markets`);
  const q = (meta.questions || [])[0];
  if (q) out(`  ${C.dim}e.g. "${q.name}":${C.reset}`);
  for (const oc of outs.filter((x) => [101, 102, 103].includes(x.outcome))) {
    const yes = mids[`#${oc.outcome}0`]; const prob = yes ? (Number(yes) * 100).toFixed(1) + '%' : '—';
    out(`     ${C.cyan}${oc.name.padEnd(14)}${C.reset} ${C.green}YES ${prob}${C.reset}  ${C.dim}/ NO ${(mids[`#${oc.outcome}1`] ? (Number(mids[`#${oc.outcome}1`]) * 100).toFixed(1) + '%' : '—')}${C.reset}`);
    await sleep(200);
  }
  await sleep(1000);

  // ── 3. THE WALLET ─────────────────────────────────────────────────────────
  out(`\n${C.mag}${C.b}━━ 3 · MANAGED-CUSTODY WALLET${C.reset}\n`);
  await step('agent.signIn()  # session key, no seed phrase exposed');
  const kp = generateGdexSessionKeyPair(); const n = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(ctrl, n, kp.sessionKey));
  const p = buildGdexSignInComputedData({ apiKey, userId: ctrl, sessionKey: kp.sessionKey, nonce: n, signature: sig.replace(/^0x/, '') });
  await s.signInWithComputedData({ computedData: p.computedData, chainId: 1 });
  const creds = { apiKey, walletAddress: ctrl, sessionPrivateKey: kp.sessionPrivateKey };
  ok(`control ${C.dim}${ctrl}${C.reset}`);
  const spot = await s.getHlSpotState(managed);
  const usdc = (spot.balances || []).find((b) => b.coin === 'USDC');
  ok(`HyperLiquid balance ${C.green}${C.b}$${Number(usdc?.total || 0).toFixed(2)} USDC${C.reset}`);
  await sleep(1000);

  // ── 4. LIVE TRADE ─────────────────────────────────────────────────────────
  out(`\n${C.mag}${C.b}━━ 4 · LIVE ON-CHAIN TRADE ${C.dim}(real order, this second)${C.reset}\n`);
  const probYes = (Number(mids['#1010']) * 100).toFixed(1);
  await step(`agent.createHlOutcomeOrder({ "Below 4.3%" YES, 0.10, x110 })`);
  const r = await s.createHlOutcomeOrder({ outcomeId: '101', coin: '#1010', isBuy: true, price: '0.10', size: '110', isMarket: false, ...creds });
  const oid = r?.data?.response?.data?.statuses?.[0]?.resting?.oid;
  ok(`order ${C.green}LIVE${C.reset} on HyperLiquid  ${C.dim}oid ${oid}${C.reset}  ${C.dim}(limit @ 10¢ vs ${probYes}¢ — resting)${C.reset}`);
  await sleep(1100);
  await step(`agent.cancelHlOutcomeOrder({ oid: ${oid} })`);
  await s.cancelHlOutcomeOrder({ outcomeId: '101', coin: '#1010', orderId: String(oid), ...creds });
  ok(`cancelled ${C.green}✓${C.reset}  ${C.dim}round trip, zero leftover${C.reset}`);
  await sleep(1100);

  // ── OUTRO ─────────────────────────────────────────────────────────────────
  out(`\n${C.cyan}${C.b}  ┌────────────────────────────────────────────────────────┐${C.reset}`);
  out(`${C.cyan}${C.b}  │${C.reset}  ${C.white}${C.b}analysis → leverage → prediction markets${C.reset}            ${C.cyan}${C.b}│${C.reset}`);
  out(`${C.cyan}${C.b}  │${C.reset}  ${C.dim}all driven by an AI agent — SDK + MCP, no UI needed${C.reset}     ${C.cyan}${C.b}│${C.reset}`);
  out(`${C.cyan}${C.b}  └────────────────────────────────────────────────────────┘${C.reset}`);
  out(`\n  ${C.dim}npx skills add ${C.reset}${C.green}GemachDAO/gdex-skill${C.reset} ${C.dim}--all${C.reset}    ${C.gray}·  gdex.pro${C.reset}\n`);
  await sleep(1500);
})().catch((e) => { out(`${C.red}demo error: ${e.message}${C.reset}`); process.exit(1); });
