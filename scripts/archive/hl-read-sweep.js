#!/usr/bin/env node
/* HyperLiquid READ/ANALYSIS sweep — no funds required. Proves every HL read
 * skill + captures market data (funding/OI/prices) for leverage analysis. */
const fs = require('fs'), os = require('os'), path = require('path');
const { GdexSkill, GDEX_API_KEY_PRIMARY } = require('../../dist');

const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const ctrl = W.control.address;
const managedEvm = (W.managed['Arbitrum (HyperLiquid)'] || {}).address || ctrl;
const s = new GdexSkill({ timeout: 45000, maxRetries: 1 });
s.loginWithApiKey(GDEX_API_KEY_PRIMARY);

let pass = 0, fail = 0;
const ok = (l, d) => { pass++; console.log(`  OK   ${l}${d ? ' — ' + d : ''}`); };
const bad = (l, e) => { fail++; console.log(`  FAIL ${l} — ${e?.message || e}`); };
async function chk(l, fn) { try { ok(l, await fn()); } catch (e) { bad(l, e); } }
const sec = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  console.log('HL READ SWEEP — control:', ctrl, '| managed(EVM):', managedEvm);

  sec('MARKET DATA / ANALYSIS INPUTS');
  let ctxs;
  await chk('getHlAllMids', async () => { const m = await s.getHlAllMids(); return `${Object.keys(m||{}).length} mids`; });
  for (const c of ['BTC', 'ETH', 'SOL']) await chk(`getHlMarkPrice(${c})`, async () => `$${await s.getHlMarkPrice(c)}`);
  await chk('getHlAllAssets', async () => { const a = await s.getHlAllAssets(); return `${Array.isArray(a)?a.length:(a?.length||'?')} assets`; });
  await chk('getHlMetaAndAssetCtxs', async () => { ctxs = await s.getHlMetaAndAssetCtxs(); const u = ctxs?.data?.[0]?.universe || ctxs?.universe || ctxs?.[0]?.universe; return `dex=${ctxs?.dex||'default'} universe=${u?.length||'?'}`; });
  await chk('getHlDepositTokens', async () => { const t = await s.getHlDepositTokens(); return `chains=${Object.keys(t?.tokens||{}).length}`; });

  sec('ACCOUNT STATE (your wallet)');
  await chk('getHlAccountState', async () => { const st = await s.getHlAccountState(ctrl); return `acctVal=$${st.accountValue} pos=${st.positions.length} withdrawable=$${st.withdrawable}`; });
  await chk('getHlClearinghouseState', async () => { const st = await s.getHlClearinghouseState(ctrl); return `keys=${Object.keys(st||{}).length}`; });
  await chk('getHlSpotState', async () => { const st = await s.getHlSpotState(ctrl); return `balances=${(st?.balances||[]).length}`; });
  await chk('getHlOpenOrders', async () => { const o = await s.getHlOpenOrders(ctrl); return `${(Array.isArray(o)?o.length:0)} orders`; });
  await chk('getPerpPositions', async () => { const p = await s.getPerpPositions({ walletAddress: ctrl }); return `${(Array.isArray(p)?p.length:0)} positions`; });
  await chk('getHlUsdcBalance', async () => JSON.stringify(await s.getHlUsdcBalance(ctrl)).slice(0, 60));
  await chk('getHlTradeHistory', async () => { const h = await s.getHlTradeHistory(ctrl); return `${(Array.isArray(h)?h.length:0)} fills`; });
  await chk('getHlUserStats(managed)', async () => JSON.stringify(await s.getHlUserStats(managedEvm)).slice(0, 80));

  sec('DISCOVERY / SOCIAL');
  await chk('getHlPerpDexes', async () => { const d = await s.getHlPerpDexes(); return `${(d?.perpDexes||[]).length} dexes`; });
  await chk('getHlTopTraders', async () => { const t = await s.getHlTopTraders(); return `${(t?.traders||t||[]).length} traders`; });
  await chk('getHlTopTradersByPnl', async () => { const t = await s.getHlTopTradersByPnl(); return `${(t?.traders||t||[]).length} traders`; });

  sec('OUTCOME MARKETS (HIP-3) — the new event markets');
  let outcomes;
  await chk('getHlOutcomes(open)', async () => { outcomes = await s.getHlOutcomes({ status: 'open' }); const arr = outcomes?.outcomes || outcomes?.markets || outcomes || []; return `${Array.isArray(arr)?arr.length:JSON.stringify(outcomes).slice(0,80)} markets`; });
  await chk('getHlOutcomes(all)', async () => { const o = await s.getHlOutcomes(); const arr = o?.outcomes||o?.markets||o||[]; return `${Array.isArray(arr)?arr.length:JSON.stringify(o).slice(0,80)} markets`; });
  await chk('getHlOutcomeAccount', async () => JSON.stringify(await s.getHlOutcomeAccount({ userAddress: ctrl })).slice(0, 100));

  sec('REFERRAL');
  await chk('getHlReferralInfo', async () => JSON.stringify(await s.getHlReferralInfo(ctrl)).slice(0, 80));
  await chk('getHlBuilderReferral', async () => JSON.stringify(await s.getHlBuilderReferral(ctrl)).slice(0, 80));

  // Dump analysis data
  sec('ANALYSIS SNAPSHOT (BTC/ETH/SOL)');
  try {
    const data = ctxs?.data || ctxs;
    const universe = data?.[0]?.universe || data?.universe;
    const stats = data?.[1] || data?.assetCtxs || (Array.isArray(data) ? data[1] : null);
    const out = {};
    if (universe && stats) {
      ['BTC', 'ETH', 'SOL'].forEach((sym) => {
        const i = universe.findIndex((u) => u.name === sym);
        if (i >= 0 && stats[i]) out[sym] = { markPx: stats[i].markPx, oraclePx: stats[i].oraclePx, funding: stats[i].funding, openInterest: stats[i].openInterest, premium: stats[i].premium, dayNtlVlm: stats[i].dayNtlVlm };
      });
    }
    fs.writeFileSync('/tmp/hl-analysis-data.json', JSON.stringify({ capturedKeysCtx: Object.keys(ctxs||{}), snapshot: out, outcomesRaw: outcomes }, null, 2));
    console.log(JSON.stringify(out, null, 2));
    console.log('(full data -> /tmp/hl-analysis-data.json)');
  } catch (e) { console.log('snapshot ERR', e.message); }

  console.log(`\nREAD SWEEP RESULT: ${pass} passed, ${fail} failed`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
