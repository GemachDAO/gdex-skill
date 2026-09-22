#!/usr/bin/env node
/* Check balances on the user-funded test wallet (control key from ~/gdex-test-wallet.json). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData, buildGdexUserSessionData,
} = require('../../dist');

const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY;
const controlAddr = W.control.address;
const wallet = new ethers.Wallet(W.control.privateKey);

async function signIn(skill, chainId) {
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(controlAddr, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: controlAddr, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  const resp = await skill.signInWithComputedData({ computedData: payload.computedData, chainId });
  return { ...kp, managed: resp.address || resp.walletAddress };
}

(async () => {
  const skill = new GdexSkill({ timeout: 45000, maxRetries: 1 });
  skill.loginWithApiKey(apiKey);
  console.log('Control:', controlAddr);

  // Solana balances via /v1/portfolio
  const sol = await signIn(skill, 622112261);
  const data = buildGdexUserSessionData(sol.sessionKey, apiKey);
  console.log('Solana managed:', sol.managed);
  try {
    const pf = await skill.client.get('/v1/portfolio', { userId: controlAddr, chainId: 622112261, data });
    const holding = pf?.portfolio?.holding || pf?.holding || pf?.balances || [];
    console.log('  Solana holdings:', JSON.stringify(holding).slice(0, 500));
  } catch (e) { console.log('  Solana portfolio ERR', e.message); }

  // HL / Arbitrum
  const arb = await signIn(skill, 42161);
  console.log('EVM managed:', arb.managed);
  try {
    const st = await skill.getHlAccountState(controlAddr);
    console.log(`  HL acctVal=$${st.accountValue} positions=${st.positions.length}`);
  } catch (e) { console.log('  HL state ERR', e.message); }
  try {
    const bal = await skill.getHlUsdcBalance(controlAddr);
    console.log('  HL USDC:', JSON.stringify(bal).slice(0, 200));
  } catch (e) { console.log('  HL usdc ERR', e.message); }
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
