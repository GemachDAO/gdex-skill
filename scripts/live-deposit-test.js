const { ethers } = require('ethers');
const { createCipheriv, createHash, randomBytes } = require('crypto');
const { AbiCoder, SigningKey, keccak256, toUtf8Bytes } = require('ethers');

// ── Config ──────────────────────────────────────────────────────────────────
const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io/v1';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Authorization': `Bearer ${apiKey}`,
};

// ── Crypto helpers (matching our fixed SDK) ─────────────────────────────────
function generateNonce() { return Date.now().toString(); }

function aesEncrypt(text, key) {
  const keyHash = createHash('sha256').update(key).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', keyHash, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function encodeHlDepositData(chainId, tokenAddress, amount, nonce) {
  const abi = AbiCoder.defaultAbiCoder();
  // FIXED: uint64 instead of uint256 for chainId
  const encoded = abi.encode(
    ['uint64', 'address', 'uint256', 'string'],
    [chainId, tokenAddress, amount, nonce]
  );
  return encoded.startsWith('0x') ? encoded.slice(2) : encoded;
}

function signMessage(action, userId, dataHex, sessionPrivateKey) {
  const msg = `${action}-${userId.toLowerCase()}-${dataHex}`;
  const digest = keccak256(toUtf8Bytes(msg));
  const sig = new SigningKey(sessionPrivateKey).sign(digest);
  const r = sig.r.replace(/^0x/, '');
  const s = sig.s.replace(/^0x/, '');
  const v = sig.yParity.toString(16).padStart(2, '0');
  return `${r}${s}${v}`;
}

function buildEncryptedPayload(apiKey, userId, data, signature) {
  const plain = JSON.stringify({ userId, data, signature, apiKey });
  return aesEncrypt(plain, apiKey);
}

// ── Sign-in helpers ─────────────────────────────────────────────────────────
function encodeSignInData(sessionKey, nonce) {
  const abi = AbiCoder.defaultAbiCoder();
  return abi.encode(['bytes', 'string', 'string'], [sessionKey, nonce, '']);
}

function buildSignInMessage(address, data) {
  const msg = `sign_in-${address.toLowerCase()}-${data.startsWith('0x') ? data.slice(2) : data}`;
  return msg;
}

const axios = require('axios');

async function main() {
  console.log('=== LIVE HL DEPOSIT TEST (with uint64 fix) ===\n');

  // Step 1: Generate session keypair
  const sessionPrivateKey = `0x${randomBytes(32).toString('hex')}`;
  const signingKey = new SigningKey(sessionPrivateKey);
  const sessionKey = signingKey.compressedPublicKey;
  console.log('Session key:', sessionKey.slice(0, 20) + '...');
  console.log('Control wallet:', wallet.address);

  // Step 2: Sign in
  console.log('\n--- Step 2: Sign In ---');
  const signInNonce = generateNonce();
  const signInData = encodeSignInData(sessionKey, signInNonce);
  const signInDataHex = signInData.startsWith('0x') ? signInData.slice(2) : signInData;
  const signInMsg = buildSignInMessage(wallet.address, signInData);
  const signInSig = await wallet.signMessage(signInMsg);
  const signInSigHex = signInSig.replace(/^0x/, '');

  const signInPayload = buildEncryptedPayload(apiKey, wallet.address, signInDataHex, signInSigHex);
  
  try {
    const resp = await axios.post(BASE + '/sign_in', { computedData: signInPayload }, { headers: HEADERS });
    console.log('Sign-in response:', JSON.stringify(resp.data).slice(0, 200));
    if (!resp.data.isSuccess) {
      console.log('Sign-in failed, aborting');
      return;
    }
  } catch (e) {
    console.log('Sign-in error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
    return;
  }

  // Step 3: Deposit 10 USDC
  console.log('\n--- Step 3: HL Deposit (10 USDC) ---');
  const depositNonce = generateNonce();
  const chainId = 42161;
  const tokenAddress = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
  const amountSmallestUnit = '10000000'; // 10 USDC = 10 * 10^6

  const data = encodeHlDepositData(chainId, tokenAddress, amountSmallestUnit, depositNonce);
  console.log('ABI data (first 40 chars):', data.slice(0, 40) + '...');
  console.log('Amount (smallest unit):', amountSmallestUnit);
  console.log('Nonce:', depositNonce);

  const signature = signMessage('hl_deposit', wallet.address, data, sessionPrivateKey);
  console.log('Signature (first 40 chars):', signature.slice(0, 40) + '...');
  console.log('Signature length:', signature.length, '(expect 130)');

  const computedData = buildEncryptedPayload(apiKey, wallet.address, data, signature);

  try {
    const resp = await axios.post(BASE + '/hl/deposit', { computedData }, { headers: HEADERS });
    console.log('\n✅ DEPOSIT RESPONSE:', JSON.stringify(resp.data, null, 2));
  } catch (e) {
    console.log('\n❌ DEPOSIT ERROR:', e.response?.status);
    console.log('Response:', JSON.stringify(e.response?.data, null, 2));
  }
}

main().catch(e => console.error('Fatal:', e.message));
