/**
 * Managed-Custody Trading Example
 *
 * Demonstrates the full GDEX managed-custody flow:
 * 1. Generate a secp256k1 session keypair
 * 2. Build the sign-in message and computedData payload
 * 3. Build an encrypted trade (purchase) payload
 * 4. Submit the trade and poll status
 *
 * This example shows how all trades go through GDEX server-side managed wallets.
 * The control wallet (EVM or Solana) is only used for sign-in authentication —
 * actual on-chain execution is handled by GDEX backend trade workers.
 *
 * Run with: npx ts-node examples/managed-trade.ts
 */

import {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexManagedTradeComputedData,
  buildGdexUserSessionData,
} from '../src';

async function main() {
  // ── Step 1: Generate Session Keypair ──────────────────────────────────────
  // A secp256k1 keypair used to sign trade payloads after sign-in.
  // The compressed public key becomes the "session key" stored server-side.
  const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
  console.log('✅ Session keypair generated');
  console.log('   Public (session key):', sessionKey);

  // ── Step 2: Build Sign-In Message ─────────────────────────────────────────
  // The control wallet (EVM or Solana) signs this message to prove ownership.
  const userId = process.env.GDEX_CONTROL_WALLET ?? '0xYourControlWalletAddress';
  const nonce = String(Date.now());
  const chainId = 900; // Solana = 900; use numeric EVM chain IDs for EVM wallets

  const signInMessage = buildGdexSignInMessage(userId, nonce, sessionKey);
  console.log('\n📝 Sign-in message (control wallet signs this):');
  console.log('  ', signInMessage.slice(0, 80) + '...');

  // In production, sign with the control wallet:
  //   EVM:    wallet.signMessage(signInMessage)       → EIP-191 personal_sign
  //   Solana: nacl.sign.detached(Buffer.from(msg))    → base58-encoded signature
  const signature = '0x' + '00'.repeat(65); // placeholder — replace with real signature

  // ── Step 3: Build sign_in computedData ─────────────────────────────────
  // Encrypts { userId, data (ABI-encoded), signature } with AES-256-CBC
  // derived from the API key's SHA256 hash chain.
  const signInPayload = buildGdexSignInComputedData({
    apiKey: GDEX_API_KEY_PRIMARY,
    userId,
    sessionKey,
    nonce,
    signature,
  });
  console.log('\n🔐 Sign-in computedData built');
  console.log('   Encrypted payload length:', signInPayload.computedData.length, 'hex chars');

  // ── Step 4: Submit Sign-In ────────────────────────────────────────────────
  const skill = new GdexSkill();
  skill.loginWithApiKey(GDEX_API_KEY_PRIMARY);

  try {
    const signInResult = await skill.signInWithComputedData({
      computedData: signInPayload.computedData,
      chainId,
    });
    console.log('\n✅ Sign-in successful:', JSON.stringify(signInResult).slice(0, 150));
  } catch (err) {
    console.warn('\n⚠️  Sign-in failed (expected with placeholder signature):', (err as Error).message);
  }

  // ── Step 5: Resolve User ──────────────────────────────────────────────────
  // After sign-in, query /v1/user to get the managed trading wallet addresses.
  const encryptedSessionData = buildGdexUserSessionData(sessionKey, GDEX_API_KEY_PRIMARY);

  try {
    const user = await skill.getManagedUser({
      userId,
      data: encryptedSessionData,
      chainId,
    });
    console.log('\n👤 User profile:', JSON.stringify(user).slice(0, 200));
  } catch (err) {
    console.warn('\n⚠️  User lookup failed:', (err as Error).message);
  }

  // ── Step 6: Build Trade Payload ───────────────────────────────────────────
  // Trade data is ABI-encoded ['string', 'uint256', 'string'] = [tokenAddress, amount, nonce]
  // then signed with the session private key (raw keccak256, no EIP-191 prefix).
  const tokenAddress = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK
  const amount = '100000'; // in smallest unit

  const tradePayload = buildGdexManagedTradeComputedData({
    apiKey: GDEX_API_KEY_PRIMARY,
    action: 'purchase',
    userId,
    tokenAddress,
    amount,
    nonce,
    sessionPrivateKey,
  });
  console.log('\n🔐 Trade computedData built');
  console.log('   Signature:', tradePayload.signature.slice(0, 40) + '...');

  // ── Step 7: Submit Trade ──────────────────────────────────────────────────
  try {
    const tradeResult = await skill.submitManagedPurchase({
      computedData: tradePayload.computedData,
      chainId,
      slippage: 1,
    });
    const requestId = tradeResult.requestId || tradeResult.jobId;
    console.log('\n✅ Trade submitted! requestId:', requestId);

    // ── Step 8: Poll Trade Status ─────────────────────────────────────────
    if (requestId) {
      console.log('\n⏳ Polling trade status...');
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        const status = await skill.getManagedTradeStatus(requestId);
        console.log(`   [${i + 1}/10] status=${status.status ?? 'unknown'}`);
        if (status.status === 'completed' || status.status === 'success') {
          console.log('✅ Trade complete! Hash:', status.hash ?? 'n/a');
          break;
        }
        if (status.status === 'failed') {
          console.log('❌ Trade failed');
          break;
        }
      }
    }
  } catch (err) {
    console.warn('\n⚠️  Trade failed:', (err as Error).message);
  }
}

main().catch(console.error);
