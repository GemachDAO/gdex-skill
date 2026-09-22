#!/usr/bin/env node
/* GDEX agent-skill full trading reel: leverage (market+limit) -> move collateral -> prediction market. Real calls. */
const fs = require('fs'), os = require('os'), path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const C = {
  reset: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[96m', green: '\x1b[92m',
  yellow: '\x1b[93m', red: '\x1b[91m', white: '\x1b[97m', mag: '\x1b[95m', gray: '\x1b[90m',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s = '') => process.stdout.write(s + '\n');
async function type(s, d = 12) { for (const ch of s) { process.stdout.write(ch); await sleep(d); } process.stdout.write('\n'); }
async function step(label) { process.stdout.write(`${C.gray}❯ ${C.reset}${C.white}`); await type(label); process.stdout.write(C.reset); await sleep(200); }
const ok = (s) => out(`  ${C.green}✓${C.reset} ${s}`);
const hdr = (n, t, sub) => out(`\n${C.mag}${C.b}━━ ${n} · ${t}${C.reset} ${C.dim}${sub || ''}${C.reset}\n`);

const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY, ctrl = W.control.address, managed = '0x0405d2c012467cdf41b12010e15fa752e59fb40b';
const wallet = new ethers.Wallet(W.control.privateKey);
const s = new GdexSkill({ timeout: 60000, maxRetries: 1 });

const BANNER = `${C.cyan}${C.b}
   ▄████  ▓█████▄ ▓█████ ▒██   ██▒
  ██▒ ▀█▒ ▒██▀ ██▌▓█   ▀ ▒▒ █ █ ▒░
 ▒██░▄▄▄░ ░██   █▌▒███   ░░  █   ░
 ░▓█  ██▓ ░▓█▄   ▌▒▓█  ▄  ░ █ █ ▒
 ░▒▓███▀▒ ░▒████▓ ░▒████▒▒██▒ ▒██▒${C.reset}
${C.dim}        AI agent · live on HyperLiquid${C.reset}`;

let creds;
async function position() { const st = await s.getHlAccountState(managed); return st.positions[0]; }

(async () => {
  console.clear();
  out(BANNER); await sleep(700);
  s.loginWithApiKey(apiKey);
  const kp = generateGdexSessionKeyPair(); const nn = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(ctrl, nn, kp.sessionKey));
  const pl = buildGdexSignInComputedData({ apiKey, userId: ctrl, sessionKey: kp.sessionKey, nonce: nn, signature: sig.replace(/^0x/, '') });
  await s.signInWithComputedData({ computedData: pl.computedData, chainId: 42161 });
  creds = { apiKey, walletAddress: ctrl, sessionPrivateKey: kp.sessionPrivateKey };
  const bal = async () => { const sp = await s.getHlSpotState(managed); return Number((sp.balances || []).find((b) => b.coin === 'USDC')?.total || 0); };
  out(`\n  ${C.dim}signed in · HyperLiquid balance ${C.green}${C.b}$${(await bal()).toFixed(2)} USDC${C.reset}`);
  await sleep(700);

  // ── 1 · LEVERAGE: MARKET ──────────────────────────────────────────────────
  hdr(1, 'LEVERAGE · MARKET ORDER', '(real BTC perp)');
  const px = await s.getHlMarkPrice('BTC');
  await step(`agent.openLong({ coin:"BTC", size:0.0002, market })`);
  await s.hlCreateOrder({ coin: 'BTC', isLong: true, price: '0', size: '0.0002', reduceOnly: false, isMarket: true, tpPrice: '0', slPrice: '0', ...creds });
  await sleep(5000);
  const pos = await position();
  if (pos) {
    const liq = Number(pos.liquidationPrice || 0);
    const liqStr = liq > 0 ? ` · liq $${liq.toLocaleString()}` : '';
    ok(`LONG open  ${C.dim}entry $${Number(pos.entryPrice).toLocaleString()} · ${pos.leverage}x${liqStr} · uPnL $${pos.unrealizedPnl}${C.reset}`);
  }
  await sleep(1100);
  await step(`agent.closePosition({ coin:"BTC" })   # reduce-only`);
  if (pos) { const szi = Number(pos.size ?? pos.szi); await s.hlCreateOrder({ coin: 'BTC', isLong: szi < 0, price: '0', size: String(Math.abs(szi)), reduceOnly: true, isMarket: true, tpPrice: '0', slPrice: '0', ...creds }); }
  await sleep(5000); ok(`position closed ${C.green}✓${C.reset}`); await sleep(1000);

  // ── 2 · LEVERAGE: LIMIT ───────────────────────────────────────────────────
  hdr(2, 'LEVERAGE · LIMIT ORDER', '(resting bid, then cancel)');
  const lim = Math.round(px * 0.66);
  const limSize = '0.001'; // proven-valid BTC size; notional ~$40 at the limit price
  await step(`agent.limitBuy({ coin:"BTC", px:$${lim.toLocaleString()}, size:${limSize} })`);
  await s.hlCreateOrder({ coin: 'BTC', isLong: true, price: String(lim), size: limSize, reduceOnly: false, isMarket: false, tpPrice: '0', slPrice: '0', ...creds });
  await sleep(4000);
  let oo = await s.getHlOpenOrders(managed); oo = Array.isArray(oo) ? oo : [];
  ok(`limit order resting  ${C.dim}oid ${oo[0]?.oid} @ $${Number(oo[0]?.limitPx || lim).toLocaleString()} (${(((px - lim) / px) * 100).toFixed(0)}% below mkt)${C.reset}`);
  await sleep(1100);
  await step(`agent.cancelOrder({ oid:${oo[0]?.oid} })`);
  if (oo[0]?.oid) await s.hlCancelOrder({ coin: 'BTC', orderId: String(oo[0].oid), ...creds });
  await sleep(3000); ok(`cancelled ${C.green}✓${C.reset}`); await sleep(1000);

  // ── 3 · MOVE COLLATERAL (HIP-3 / HIP-4 currency) ──────────────────────────
  hdr(3, 'MOVE COLLATERAL', '(HyperLiquid spot · USDC ⇄ USDH)');
  await step(`agent.swapCollateral({ USDC → USDH, 10 })`);
  await s.hlSwapCollateral({ fromToken: 'USDC', toToken: 'USDH', amount: '10', ...creds });
  await sleep(5000); ok(`swapped to USDH ${C.green}✓${C.reset}  ${C.dim}HIP-3/HIP-4 markets settle in their own currency${C.reset}`);
  await sleep(900);
  await step(`agent.swapCollateral({ USDH → USDC, 10 })   # route back`);
  await s.hlSwapCollateral({ fromToken: 'USDH', toToken: 'USDC', amount: '10', ...creds });
  await sleep(5000); ok(`collateral routed ${C.green}✓${C.reset}`); await sleep(1000);

  // ── 4 · PREDICTION MARKET ─────────────────────────────────────────────────
  hdr(4, 'PREDICTION MARKET', '(HyperLiquid HIP-3 event market)');
  const o = await s.getHlOutcomes({ status: 'open' });
  const mids = o?.data?.mids || {};
  const prob = (Number(mids['#1421']) * 100 || 0).toFixed(1);
  out(`  ${C.dim}"2026 NBA Finals champion" — New York${C.reset}  ${C.green}${prob}%${C.reset}  ${C.dim}implied${C.reset}`);
  await step(`agent.createOutcomeOrder({ NewYork YES, limit 0.10, x110 })`);
  const r = await s.createHlOutcomeOrder({ outcomeId: '142', coin: '#1421', isBuy: true, price: '0.10', size: '110', isMarket: false, ...creds });
  const oid = r?.data?.response?.data?.statuses?.[0]?.resting?.oid;
  ok(`event order ${C.green}LIVE${C.reset}  ${C.dim}oid ${oid} (limit @ 10¢ — resting)${C.reset}`);
  await sleep(1100);
  await step(`agent.cancelOutcomeOrder({ oid:${oid} })`);
  await s.cancelHlOutcomeOrder({ outcomeId: '142', coin: '#1421', orderId: String(oid), ...creds });
  await sleep(3000); ok(`cancelled ${C.green}✓${C.reset}  ${C.dim}round trip complete${C.reset}`);
  await sleep(1200);

  // ── OUTRO ─────────────────────────────────────────────────────────────────
  out(`\n${C.cyan}${C.b}  ┌──────────────────────────────────────────────────────────┐${C.reset}`);
  out(`${C.cyan}${C.b}  │${C.reset}  ${C.white}${C.b}leverage · limit orders · collateral routing · events${C.reset}    ${C.cyan}${C.b}│${C.reset}`);
  out(`${C.cyan}${C.b}  │${C.reset}  ${C.dim}one AI agent, real HyperLiquid trades — SDK + MCP${C.reset}         ${C.cyan}${C.b}│${C.reset}`);
  out(`${C.cyan}${C.b}  └──────────────────────────────────────────────────────────┘${C.reset}`);
  out(`\n  ${C.dim}npx skills add ${C.reset}${C.green}GemachDAO/gdex-skill${C.reset} ${C.dim}--all${C.reset}   ${C.gray}·  gdex.pro${C.reset}\n`);
  await sleep(1500);
})().catch((e) => { out(`${C.red}demo error: ${e.responseBody ? JSON.stringify(e.responseBody) : e.message}${C.reset}`); process.exit(1); });
