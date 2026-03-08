/**
 * Check HL info endpoints for managed wallet state and 
 * try to derive the managed wallet's private key.
 */
const { Wallet, keccak256, toUtf8Bytes, sha256 } = require('ethers');
const { createHash } = require('crypto');
const axios = require('axios');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const wallet = Wallet.fromPhrase(mnemonic);
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
const HL_INFO = 'https://api.hyperliquid.xyz/info';
const H = { 'Content-Type': 'application/json' };

async function hlInfo(body) {
  const resp = await axios.post(HL_INFO, body, { headers: H });
  return resp.data;
}

(async () => {
  console.log('Control wallet:', wallet.address);
  console.log('Managed wallet:', managedAddr);
  
  // === 1. Check various HL info endpoints ===
  console.log('\n=== HL Info Endpoints ===');
  
  // userFees
  try {
    const fees = await hlInfo({ type: 'userFees', user: managedAddr });
    console.log('userFees:', JSON.stringify(fees));
  } catch (e) {
    console.log('userFees error:', e.response?.data || e.message);
  }
  
  // userRateLimit
  try {
    const rate = await hlInfo({ type: 'userRateLimit', user: managedAddr });
    console.log('userRateLimit:', JSON.stringify(rate));
  } catch (e) {
    console.log('userRateLimit error:', e.response?.data || e.message);
  }
  
  // referral
  try {
    const ref = await hlInfo({ type: 'referral', user: managedAddr });
    console.log('referral:', JSON.stringify(ref));
  } catch (e) {
    console.log('referral error:', e.response?.data || e.message);
  }
  
  // maxBuilderFee
  try {
    const builderFee = await hlInfo({ type: 'maxBuilderFee', user: managedAddr, builder: '0x1bd80b4165CEED7F9404f8D59dFD3A8fA5d445E7' });
    console.log('maxBuilderFee:', JSON.stringify(builderFee));
  } catch (e) {
    console.log('maxBuilderFee error:', e.response?.data || e.message);
  }
  
  // spotClearinghouseState
  try {
    const spotState = await hlInfo({ type: 'spotClearinghouseState', user: managedAddr });
    console.log('spotClearinghouseState balances:', spotState.balances?.length);
  } catch (e) {
    console.log('spotClearinghouseState error:', e.response?.data || e.message);
  }
  
  // clearinghouseState (full)
  const state = await hlInfo({ type: 'clearinghouseState', user: managedAddr });
  console.log('\nclearinghouseState (full):');
  console.log(JSON.stringify(state, null, 2));
  
  // === 2. Try to derive managed wallet key ===
  console.log('\n=== Key Derivation Attempts ===');
  
  const derivations = [
    // Hash of apiKey + userId
    { label: 'sha256(apiKey + userId)', key: createHash('sha256').update(apiKey + wallet.address).digest('hex') },
    { label: 'sha256(userId + apiKey)', key: createHash('sha256').update(wallet.address + apiKey).digest('hex') },
    { label: 'sha256(apiKey + userId.lower)', key: createHash('sha256').update(apiKey + wallet.address.toLowerCase()).digest('hex') },
    { label: 'sha256(userId.lower + apiKey)', key: createHash('sha256').update(wallet.address.toLowerCase() + apiKey).digest('hex') },
    // keccak256 of various combos
    { label: 'keccak256(apiKey + userId)', key: keccak256(toUtf8Bytes(apiKey + wallet.address)).slice(2) },
    { label: 'keccak256(userId + apiKey)', key: keccak256(toUtf8Bytes(wallet.address + apiKey)).slice(2) },
    { label: 'keccak256(userId.lower)', key: keccak256(toUtf8Bytes(wallet.address.toLowerCase())).slice(2) },
    // Using mnemonic derivation paths
    // m/44'/60'/0'/0/1 (index 1 instead of 0)
  ];
  
  for (const d of derivations) {
    try {
      const w = new Wallet('0x' + d.key);
      const matches = w.address.toLowerCase() === managedAddr.toLowerCase();
      if (matches) {
        console.log(`✅ MATCH! ${d.label}: ${w.address}`);
        console.log(`Private key: ${w.privateKey}`);
      }
    } catch (e) {
      // Invalid key
    }
  }
  
  // Try HD derivation from our mnemonic with different paths
  const hdPaths = [
    "m/44'/60'/0'/0/1",
    "m/44'/60'/0'/0/2", 
    "m/44'/60'/0'/1/0",
    "m/44'/60'/1'/0/0",
    "m/44'/60'/0'/0/0", // same as default (our control wallet)
  ];
  
  for (const path of hdPaths) {
    const hdWallet = Wallet.fromPhrase(mnemonic, path);
    const matches = hdWallet.address.toLowerCase() === managedAddr.toLowerCase();
    if (matches) {
      console.log(`✅ HD MATCH! path=${path}: ${hdWallet.address}`);
      console.log(`Private key: ${hdWallet.privateKey}`);
    }
  }
  
  // Try using ethers HDNodeWallet
  const { HDNodeWallet } = require('ethers');
  const hdNode = HDNodeWallet.fromPhrase(mnemonic);
  for (let i = 0; i < 20; i++) {
    const child = hdNode.derivePath(`m/44'/60'/0'/0/${i}`);
    if (child.address.toLowerCase() === managedAddr.toLowerCase()) {
      console.log(`✅ HD index ${i} MATCH: ${child.address}`);
      console.log(`Private key: ${child.privateKey}`);
    }
  }
  
  console.log('(No derivation match found — managed wallet key is likely stored in backend DB)');
  
  console.log('\nDone');
})().catch(e => {
  console.error('Fatal:', e.message);
  if (e.response) console.error('Response:', e.response.status, JSON.stringify(e.response.data).slice(0, 500));
});
