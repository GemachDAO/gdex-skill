#!/usr/bin/env node
/* Deposit USDC from the Arbitrum managed wallet into HyperLiquid. Real funds. */
const fs = require('fs'), os = require('os'), path = require('path');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const AMOUNT = process.env.DEP_AMOUNT || '14.5';
const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY, ctrl = W.control.address, wallet = new ethers.Wallet(W.control.privateKey);

(async () => {
  const s = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  s.loginWithApiKey(apiKey);
  // Sign in (chainId 1 per gdex-perp-funding for deposit/withdraw)
  const kp = generateGdexSessionKeyPair();
  const nonce = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(ctrl, nonce, kp.sessionKey));
  const p = buildGdexSignInComputedData({ apiKey, userId: ctrl, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, '') });
  const signin = await s.signInWithComputedData({ computedData: p.computedData, chainId: 1 });
  console.log('signed in (chainId 1), managed=', signin.address || signin.walletAddress);

  console.log(`Depositing ${AMOUNT} USDC to HL (control=${ctrl})...`);
  const r = await s.perpDeposit({
    amount: AMOUNT,
    tokenAddress: USDC_ARB,
    chainId: 42161,
    apiKey,
    walletAddress: ctrl,
    sessionPrivateKey: kp.sessionPrivateKey,
  });
  console.log('DEPOSIT RESULT:', JSON.stringify(r).slice(0, 300));
})().catch((e) => { console.error('FATAL', e.response?.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
