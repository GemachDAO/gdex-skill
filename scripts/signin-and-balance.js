#!/usr/bin/env node
/**
 * Refresh the managed-custody sign-in for the saved wallet and print holdings.
 * Mirrors the proven flow in scripts/archive/trade-my-wallet.js: fresh session
 * keypair, generateGdexNonce(), 0x stripped from the control-wallet signature,
 * sign-in + portfolio read on the Solana managed chainId.
 *
 * Auth + read only — does NOT place any trade.
 *   node scripts/signin-and-balance.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ethers } = require('ethers');
const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  generateGdexNonce,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
} = require(path.join(__dirname, '..', 'dist'));

const SOLANA = 622112261;
const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
const controlAddr = W.control.address;
const wallet = new ethers.Wallet(W.control.privateKey);

async function main() {
  const skill = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  skill.loginWithApiKey(apiKey);
  console.log(`Control wallet (userId): ${controlAddr}`);

  const kp = generateGdexSessionKeyPair();
  const sessionKey = kp.sessionKey;
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(controlAddr, nonce, sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: controlAddr, sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  const resp = await skill.signInWithComputedData({ computedData: payload.computedData, chainId: SOLANA });
  console.log(`Sign-in OK — managed wallet: ${resp.address || resp.walletAddress || JSON.stringify(resp).slice(0, 120)}\n`);

  const data = buildGdexUserSessionData(sessionKey, apiKey);
  const pf = await skill.client.get('/v1/portfolio', { userId: controlAddr, chainId: SOLANA, data });
  const holding = pf?.portfolio?.holding || pf?.holding || [];
  const totalUsd = pf?.portfolio?.totalUsd ?? pf?.totalUsd;
  console.log(`Holdings: ${holding.length} token(s)${totalUsd !== undefined ? `, total≈$${totalUsd}` : ''}`);
  for (const h of holding) {
    const sym = h.tokenInfo?.symbol || h.symbol || h.address;
    const ui = h.uiAmount ?? h.amount;
    const usd = h.usdValue ?? h.valueUsd;
    console.log(`   ${sym}: ${ui}${usd !== undefined ? ` ($${usd})` : ''}`);
  }
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
