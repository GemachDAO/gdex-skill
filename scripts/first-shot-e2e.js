#!/usr/bin/env node
/*
 * First-shot end-to-end runner.
 *
 * Default mode is dry-run preflight (no trades).
 * To execute a real trade, set CONFIRM_LIVE_TRADE=YES.
 */

const { GdexSkill, GDEX_API_KEY_PRIMARY, Endpoints } = require('../dist/index.js');

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[92m';
const RED = '\x1b[91m';
const YELLOW = '\x1b[93m';
const WHITE = '\x1b[97m';

function section(title) {
  console.log(`\n${BOLD}${WHITE}${title}${RESET}`);
}

function ok(msg) {
  console.log(`  ${GREEN}OK${RESET} ${msg}`);
}

function warn(msg) {
  console.log(`  ${YELLOW}WARN${RESET} ${msg}`);
}

function fail(msg) {
  console.log(`  ${RED}FAIL${RESET} ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractStatus(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.status === 'string') return payload.status;
  if (payload.data && typeof payload.data === 'object' && typeof payload.data.status === 'string') {
    return payload.data.status;
  }
  return null;
}

function pickRequestId(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  if (typeof payload.requestId === 'string' && payload.requestId.length > 0) return payload.requestId;
  if (typeof payload.jobId === 'string' && payload.jobId.length > 0) return payload.jobId;
  if (typeof payload.id === 'string' && payload.id.length > 0) return payload.id;
  return undefined;
}

async function pollTradeStatus(skill, jobId, attempts, intervalMs) {
  for (let i = 1; i <= attempts; i++) {
    try {
      let statusPayload;
      try {
        statusPayload = await skill.client.get(Endpoints.tradeStatusPath(jobId));
      } catch {
        statusPayload = await skill.client.get(Endpoints.TRADE_STATUS, { jobId, requestId: jobId });
      }
      const status = extractStatus(statusPayload);
      console.log(`  Poll ${i}/${attempts}: status=${status ?? 'unknown'}`);

      if (status === 'completed' || status === 'confirmed') {
        return { done: true, success: true, payload: statusPayload };
      }
      if (status === 'failed') {
        return { done: true, success: false, payload: statusPayload };
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      warn(`Trade status poll failed (${msg})`);
    }

    await sleep(intervalMs);
  }

  return { done: false, success: false, payload: null };
}

async function main() {
  const chain = process.env.FIRST_SHOT_CHAIN || 'solana';
  const tokenAddress =
    process.env.FIRST_SHOT_TOKEN_ADDRESS || 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK
  const amount = process.env.FIRST_SHOT_AMOUNT || '0.001';
  const slippage = Number(process.env.FIRST_SHOT_SLIPPAGE || '1');
  const walletAddress = process.env.FIRST_SHOT_WALLET || undefined;
  const confirmLive = process.env.CONFIRM_LIVE_TRADE === 'YES';
  const pollAttempts = Number(process.env.FIRST_SHOT_POLL_ATTEMPTS || '18');
  const pollIntervalMs = Number(process.env.FIRST_SHOT_POLL_INTERVAL_MS || '10000');
  const computedDataBuy = process.env.GDEX_COMPUTED_DATA_BUY || '';
  const managedChainId = process.env.GDEX_MANAGED_CHAIN_ID || '';

  const skill = new GdexSkill({ timeout: 45000, maxRetries: 1 });

  section('1. Authentication');
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);
  if (!skill.isAuthenticated()) {
    throw new Error('Authentication failed');
  }
  ok('Authenticated with shared API key');

  section('2. Live preflight checks');
  const token = await skill.getTokenDetails({ chain, tokenAddress });
  ok(`Token details reachable (keys=${Object.keys(token || {}).length})`);

  if (walletAddress) {
    try {
      await skill.getPortfolio({ walletAddress });
      ok(`Portfolio endpoint reachable for wallet ${walletAddress.slice(0, 10)}...`);
    } catch (err) {
      const statusCode = err && typeof err === 'object' ? err.statusCode : undefined;
      if (statusCode === 400) {
        ok('Portfolio endpoint reachable (received expected validation 400)');
      } else {
        throw err;
      }
    }
  } else {
    warn('FIRST_SHOT_WALLET not set; skipping wallet-scoped preflight check');
  }

  section('3. Trade execution gate');
  console.log(`  chain=${chain}`);
  console.log(`  tokenAddress=${tokenAddress}`);
  console.log(`  amount=${amount}`);
  console.log(`  slippage=${slippage}%`);
  console.log(`  walletAddress=${walletAddress || '(backend default/account context)'}`);

  if (!confirmLive) {
    warn('Dry-run mode only. Set CONFIRM_LIVE_TRADE=YES to place a real trade.');
    return;
  }

  section('4. Live tiny trade');
  const buyResult = computedDataBuy
    ? await skill.submitManagedPurchase({
        computedData: computedDataBuy,
        chainId: managedChainId || 900,
        slippage,
      })
    : await skill.buyToken({
        chain,
        tokenAddress,
        amount,
        slippage,
        walletAddress,
      });

  const requestId = pickRequestId(buyResult);

  ok(
    `Buy submitted: status=${buyResult.status || 'unknown'} requestId=${requestId || 'n/a'}`
  );

  if (requestId) {
    section('5. Trade status polling');
    const poll = await pollTradeStatus(skill, requestId, pollAttempts, pollIntervalMs);
    if (poll.done && poll.success) {
      ok('Trade reached completed/confirmed state');
    } else if (poll.done && !poll.success) {
      fail('Trade reached failed state');
      process.exitCode = 1;
    } else {
      warn('Polling finished without terminal state; check backend dashboard/job status');
    }
  } else {
    warn('No requestId returned, cannot poll status automatically');
  }
}

main().catch((err) => {
  fail(err && err.message ? err.message : String(err));
  process.exit(1);
});
