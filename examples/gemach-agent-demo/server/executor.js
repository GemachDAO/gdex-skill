/*
 * Executor — drives the GDEX demo flow, FULLY LIVE on HyperLiquid via the shipped SDK:
 *   - perp legs   : real leverage market/limit orders + closes (hlCreateOrder / hlCancelOrder)
 *   - move funds  : real HL collateral swap (hlSwapCollateral, USDC<->USDH)
 *   - outcome legs: real resting orders on the CPI prediction market (createHlOutcomeOrder)
 * All state is read live from HyperLiquid.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ethers } = require('ethers');
const axios = require('axios');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('@gdexsdk/gdex-skill');

const WALLET_PATH = process.env.GDEX_WALLET || path.join(os.homedir(), 'gdex-test-wallet.json');
const WALLET = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
const API_KEY = GDEX_API_KEY_PRIMARY;
const CONTROL = WALLET.control.address;
const MANAGED = WALLET.managed['Arbitrum (HyperLiquid)'].address;
const CPI_OUTCOME = '101';
const CPI_COIN_YES = '#1010';

const hlInfo = (body) =>
  axios.post('https://api.hyperliquid.xyz/info', body, { headers: { 'Content-Type': 'application/json' } }).then((r) => r.data);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  ready: false, control: CONTROL, managed: MANAGED, log: [],
  prices: { BTC: 0 },
  perp: { accountValue: 0, positions: [], openOrders: [], limitOid: null },
  spot: {},
  outcome: { oids: [], openOrders: [] },
};

let skill = null;
let creds = null;

function logEvent(kind, message, extra = {}) {
  state.log.unshift({ ts: Date.now(), kind, message, ...extra });
  if (state.log.length > 40) state.log.pop();
}

async function signIn() {
  skill = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  skill.loginWithApiKey(API_KEY);
  const wallet = new ethers.Wallet(WALLET.control.privateKey);
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(CONTROL, nonce, kp.sessionKey));
  const payload = buildGdexSignInComputedData({
    apiKey: API_KEY, userId: CONTROL, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  await skill.signInWithComputedData({ computedData: payload.computedData, chainId: 1 });
  creds = { apiKey: API_KEY, walletAddress: CONTROL, sessionPrivateKey: kp.sessionPrivateKey };
  try { await skill.hlEnableTrading(creds); } catch (_) {}
  state.ready = true;
  logEvent('system', `Signed in · managed ${MANAGED.slice(0, 8)}…`);
}

async function refreshState() {
  try { state.prices.BTC = Number((await hlInfo({ type: 'allMids' })).BTC) || state.prices.BTC; } catch (_) {}
  try {
    const ch = await hlInfo({ type: 'clearinghouseState', user: MANAGED });
    state.perp.accountValue = Number(ch.marginSummary?.accountValue) || 0;
    state.perp.positions = (ch.assetPositions || []).map((p) => {
      const szi = Number(p.position.szi);
      return {
        coin: p.position.coin,
        side: szi >= 0 ? 'long' : 'short',
        notional: Math.abs(Number(p.position.positionValue)),
        entry: Number(p.position.entryPx),
        pnl: Number(p.position.unrealizedPnl),
        leverage: p.position.leverage?.value,
      };
    });
  } catch (_) {}
  try {
    const oo = await hlInfo({ type: 'openOrders', user: MANAGED });
    state.perp.openOrders = (oo || []).filter((o) => !o.coin.startsWith('#')).map((o) => ({ coin: o.coin, side: o.side, px: o.limitPx, sz: o.sz, oid: o.oid }));
    state.outcome.openOrders = (oo || []).filter((o) => o.coin.startsWith('#')).map((o) => ({ coin: o.coin, side: o.side, px: o.limitPx, sz: o.sz, oid: o.oid }));
  } catch (_) {}
  try {
    const sp = await hlInfo({ type: 'spotClearinghouseState', user: MANAGED });
    const m = {};
    (sp.balances || []).forEach((b) => { if (Number(b.total) > 0.01) m[b.coin] = Number(b.total); });
    state.spot = m;
  } catch (_) {}
  return getState();
}

const getState = () => JSON.parse(JSON.stringify(state));

async function outcomeMid() {
  try { const o = await skill.getHlOutcomes(); const px = Number((o?.data?.mids || o?.mids || {})[CPI_COIN_YES]); if (px > 0 && px < 1) return px; } catch (_) {}
  return 0.5;
}

// ---- Real perp legs ----
async function perpOpen() {
  const px = state.prices.BTC;
  const size = (13 / px).toFixed(5); // ~$13 notional, clears the $11 min on close
  try { await skill.hlUpdateLeverage({ ...creds, coin: 'BTC', leverage: 10, isCross: true }); } catch (_) {}
  logEvent('perp', `Open LONG BTC ~$13 · ${size} @ $${px.toLocaleString()}`, { live: true });
  const r = await skill.hlCreateOrder({ ...creds, coin: 'BTC', isLong: true, price: String(px), size, isMarket: true });
  await sleep(4000); await refreshState();
  const p = state.perp.positions.find((x) => x.coin === 'BTC');
  logEvent('perp', p ? `Position open · ${p.coin} ${p.side.toUpperCase()} $${p.notional.toFixed(2)} @ $${p.entry.toLocaleString()}` : 'Open sent', { live: true, ok: !!r?.isSuccess });
  return getState();
}
async function perpClose() {
  await refreshState();
  const p = state.perp.positions.find((x) => x.coin === 'BTC');
  if (!p) { logEvent('perp', 'No perp position to close', { live: true }); return getState(); }
  const ch = await hlInfo({ type: 'clearinghouseState', user: MANAGED });
  const pos = (ch.assetPositions || []).find((a) => a.position.coin === 'BTC');
  const szi = Number(pos.position.szi); const size = String(Math.abs(szi));
  logEvent('perp', `Close ${p.coin} ${p.side.toUpperCase()} · PnL ${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)}`, { live: true });
  const r = await skill.hlCreateOrder({ ...creds, coin: 'BTC', isLong: szi < 0, price: String(state.prices.BTC), size, isMarket: true, reduceOnly: true });
  await sleep(4000); await refreshState();
  logEvent('perp', 'Position closed', { live: true, ok: !!r?.isSuccess });
  return getState();
}
async function perpLimit() {
  const px = state.prices.BTC;
  const lpx = Math.round(px * 0.95);
  const size = (12 / lpx).toFixed(5); // size*price >= $11 min
  logEvent('perp', `Place LONG limit BTC · ${size} @ $${lpx.toLocaleString()}`, { live: true });
  const r = await skill.hlCreateOrder({ ...creds, coin: 'BTC', isLong: true, price: String(lpx), size, isMarket: false });
  await sleep(3000); await refreshState();
  state.perp.limitOid = state.perp.openOrders[0]?.oid ?? (JSON.stringify(r || {}).match(/"oid":(\d+)/) || [])[1] ?? null;
  logEvent('perp', `Limit order resting · oid ${state.perp.limitOid ?? '—'}`, { live: true, ok: !!r?.isSuccess });
  return getState();
}
async function perpCancel() {
  await refreshState();
  const oid = state.perp.limitOid || state.perp.openOrders[0]?.oid;
  if (!oid) { logEvent('perp', 'No perp limit order to cancel', { live: true }); return getState(); }
  logEvent('perp', `Cancel BTC limit order · oid ${oid}`, { live: true });
  const r = await skill.hlCancelOrder({ ...creds, coin: 'BTC', orderId: String(oid) });
  state.perp.limitOid = null;
  await sleep(2500); await refreshState();
  logEvent('perp', 'Limit order cancelled', { live: true, ok: !!r?.isSuccess });
  return getState();
}

// ---- Real collateral move (HL swap) ----
async function moveFunds({ amount = '11' } = {}) {
  logEvent('move', `Moving collateral on HyperLiquid: USDC → USDH ($${amount})`, { live: true });
  await skill.hlSwapCollateral({ ...creds, fromToken: 'USDC', toToken: 'USDH', amount });
  await sleep(5000); await refreshState();
  const usdh = Math.floor(Number(state.spot.USDH || 0) * 100) / 100;
  logEvent('move', `Swapped into USDH · balance ${usdh} USDH`, { live: true, ok: true });
  await sleep(1500);
  if (usdh > 0) {
    logEvent('move', `Moving collateral back: USDH → USDC (${usdh})`, { live: true });
    await skill.hlSwapCollateral({ ...creds, fromToken: 'USDH', toToken: 'USDC', amount: String(usdh) });
    await sleep(5000); await refreshState();
    logEvent('move', `Collateral restored to USDC · ${Number(state.spot.USDC || 0).toFixed(2)} USDC`, { live: true });
  }
  return getState();
}

// ---- Real outcome legs (CPI prediction market) ----
async function placeOutcomeLimit(price, size, note) {
  logEvent('outcome', `${note} · CPI "Below 4.3%" Yes · ${size} @ ${price}`, { live: true });
  const r = await skill.createHlOutcomeOrder({ ...creds, outcomeId: CPI_OUTCOME, coin: CPI_COIN_YES, isBuy: true, price: String(price), size: String(size), isMarket: false });
  const oid = (JSON.stringify(r || {}).match(/"oid":(\d+)/) || [])[1];
  if (oid) state.outcome.oids = [...(state.outcome.oids || []), oid];
  await sleep(3000); await refreshState();
  logEvent('outcome', `Order resting on the book · oid ${oid ?? '—'}`, { live: true, ok: !!r?.isSuccess });
  return getState();
}
const outcomeOrder = () => placeOutcomeLimit('0.05', '110', 'Outcome order · limit buy');
const outcomeLimitOrder = () => placeOutcomeLimit('0.03', '110', 'Outcome limit order · resting bid');
async function outcomeCancelAll() {
  await refreshState();
  const oids = (state.outcome.openOrders || []).map((o) => o.oid);
  if (!oids.length) { logEvent('outcome', 'No outcome orders to close', { live: true }); return getState(); }
  logEvent('outcome', `Closing ${oids.length} outcome order(s)…`, { live: true });
  for (const oid of oids) { try { await skill.cancelHlOutcomeOrder({ ...creds, outcomeId: CPI_OUTCOME, coin: CPI_COIN_YES, orderId: String(oid) }); } catch (_) {} }
  state.outcome.oids = [];
  await sleep(2500); await refreshState();
  logEvent('outcome', 'Outcome orders cancelled · book clear', { live: true, ok: true });
  return getState();
}

module.exports = {
  signIn, refreshState, getState, logEvent,
  perpOpen, perpClose, perpLimit, perpCancel,
  moveFunds, outcomeOrder, outcomeLimitOrder, outcomeCancelAll,
};
