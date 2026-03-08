/**
 * Find the managed Solana wallet address using chainId=622112261.
 * Uses the SDK (same approach as live-hl-test.js that works).
 */
const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
} = require('../dist/index.js');
const { ethers } = require('ethers');

const mnemonic = process.env.GDEX_MNEMONIC || 'airport room shoe add offer price divide sell make army say celery';
const apiKey = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
const SOLANA_CHAIN_ID = 622112261;

async function main() {
  const evmWallet = ethers.Wallet.fromPhrase(mnemonic);
  const controlAddress = evmWallet.address;
  console.log('Control address:', controlAddress);
  console.log('Solana chain ID:', SOLANA_CHAIN_ID);

  // ── Step 1: Generate session keypair ───────────────────────────────────
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  console.log('Session key:', sessionKey.slice(0, 20) + '...');

  // ── Step 2: Sign in (use timestamp nonce like working HL test) ─────────
  const nonce = String(Date.now());
  const signInMessage = buildGdexSignInMessage(controlAddress, nonce, sessionKey);
  const signature = await evmWallet.signMessage(signInMessage);

  const signInPayload = buildGdexSignInComputedData({
    apiKey,
    userId: controlAddress,
    sessionKey,
    nonce,
    signature,
  });

  const skill = new GdexSkill({ timeout: 60000, maxRetries: 2 });
  skill.loginWithApiKey(apiKey);

  // Sign in with chainId=1 (EVM auth always works)
  console.log('\n=== Sign-in (chainId=1) ===');
  try {
    const signInResult = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId: 1,
    });
    console.log('Sign-in result:', JSON.stringify(signInResult).slice(0, 300));
  } catch (err) {
    console.log('Sign-in error:', err.message);
    console.log('(Continuing anyway — session key may already be registered)');
  }

  // ── Step 3: GET /v1/user with chainId=622112261 (Solana) ──────────────
  const userDataEncrypted = buildGdexUserSessionData(sessionKey, apiKey);

  console.log('\n=== /v1/user chainId=622112261 ===');
  try {
    const user = await skill.getManagedUser({
      userId: controlAddress,
      data: userDataEncrypted,
      chainId: SOLANA_CHAIN_ID,
    });
    console.log('User response (FULL):');
    console.log(JSON.stringify(user, null, 2));
  } catch (err) {
    console.log('User lookup error:', err.message);
    if (err.responseBody) console.log('Body:', JSON.stringify(err.responseBody).slice(0, 500));
  }

  // Also try with chainId=1 to compare
  console.log('\n=== /v1/user chainId=1 (for comparison) ===');
  try {
    const user = await skill.getManagedUser({
      userId: controlAddress,
      data: userDataEncrypted,
      chainId: 1,
    });
    console.log('User response (chainId=1):');
    console.log(JSON.stringify(user, null, 2));
  } catch (err) {
    console.log('Error:', err.message);
  }

  // Try with chainId=900 (the old incorrect Solana ID)
  console.log('\n=== /v1/user chainId=900 (old ID) ===');
  try {
    const user = await skill.getManagedUser({
      userId: controlAddress,
      data: userDataEncrypted,
      chainId: 900,
    });
    console.log('User response (chainId=900):');
    console.log(JSON.stringify(user, null, 2));
  } catch (err) {
    console.log('Error:', err.message);
  }

  // Sign in directly with chainId=622112261
  console.log('\n=== Sign-in (chainId=622112261) ===');
  try {
    const signInResult = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId: SOLANA_CHAIN_ID,
    });
    console.log('Sign-in result:', JSON.stringify(signInResult).slice(0, 300));
  } catch (err) {
    console.log('Sign-in error:', err.message);
    if (err.responseBody) console.log('Body:', JSON.stringify(err.responseBody).slice(0, 500));
  }

  // After Solana sign-in, try user again
  console.log('\n=== /v1/user (after Solana sign-in) ===');
  try {
    const user = await skill.getManagedUser({
      userId: controlAddress,
      data: userDataEncrypted,
      chainId: SOLANA_CHAIN_ID,
    });
    console.log('User response:');
    console.log(JSON.stringify(user, null, 2));
  } catch (err) {
    console.log('Error:', err.message);
  }
}

main().catch(e => console.error('Fatal:', e.message));
