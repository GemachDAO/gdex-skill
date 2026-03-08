const { ethers, AbiCoder, SigningKey, keccak256, toUtf8Bytes } = require('ethers');
const axios = require('axios');
const { createHash, createCipheriv } = require('crypto');
const {
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../dist/utils/gdexManagedCrypto');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Authorization': 'Bearer ' + apiKey,
};

let sessionPrivateKey;

function buildCD(action, abiTypes, abiValues) {
  const abi = AbiCoder.defaultAbiCoder();
  const encoded = abi.encode(abiTypes, abiValues);
  const data = encoded.startsWith('0x') ? encoded.slice(2) : encoded;
  const signMsg = `${action}-${wallet.address.toLowerCase()}-${data}`;
  const digest = keccak256(toUtf8Bytes(signMsg));
  const sigObj = new SigningKey(sessionPrivateKey).sign(digest);
  const r = sigObj.r.replace(/^0x/, '');
  const s = sigObj.s.replace(/^0x/, '');
  const v = sigObj.v === 27 ? '1b' : '1c';
  const signature = r + s + v;
  const jsonPayload = JSON.stringify({ userId: wallet.address, data, signature, apiKey });
  const hashApiHex = createHash('sha256').update(apiKey).digest('hex');
  const keyHex = hashApiHex.slice(0, 64);
  const ivHex = createHash('sha256').update(hashApiHex).digest('hex').slice(0, 32);
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), Buffer.from(ivHex, 'hex'));
  return cipher.update(jsonPayload, 'utf8', 'hex') + cipher.final('hex');
}

(async () => {
  const kp = generateGdexSessionKeyPair();
  sessionPrivateKey = kp.sessionPrivateKey;
  const nonce = generateGdexNonce().toString();
  const msg = buildGdexSignInMessage(wallet.address, nonce, kp.sessionKey);
  const sig = await wallet.signMessage(msg);
  const payload = buildGdexSignInComputedData({
    apiKey, userId: wallet.address, sessionKey: kp.sessionKey, nonce, signature: sig.replace(/^0x/, ''),
  });
  await axios.post(BASE + '/sign_in', { computedData: payload.computedData, chainId: 42161 }, { headers: HEADERS });
  console.log('Signed in');

  const n = Date.now().toString();

  // Try computedData format for leverage endpoints
  const actions = ['hl_update_leverage', 'hl_set_leverage', 'update_leverage'];
  const endpoints = ['/hl/update_leverage', '/hl/leverage'];

  const abiVariations = [
    { types: ['string', 'uint32', 'bool', 'string'], values: ['BTC', 50, true, n], label: '[coin, lev, isCross, nonce]' },
    { types: ['uint32', 'bool', 'string', 'string'], values: [50, true, 'BTC', n], label: '[lev, isCross, coin, nonce]' },
    { types: ['string', 'string', 'bool', 'string'], values: ['BTC', '50', true, n], label: '[coin, levStr, isCross, nonce]' },
  ];

  for (const action of actions) {
    for (const ep of endpoints) {
      for (const abi of abiVariations) {
        try {
          const cd = buildCD(action, abi.types, abi.values);
          const resp = await axios.post(BASE + ep, { computedData: cd }, { headers: HEADERS });
          console.log(`✅ ${action} → ${ep} ${abi.label}: ${JSON.stringify(resp.data).slice(0, 200)}`);
        } catch (e) {
          const status = e.response?.status;
          if (status !== 404) {
            console.log(`⚠️  ${action} → ${ep} ${abi.label}: ${status} ${JSON.stringify(e.response?.data).slice(0, 200)}`);
          }
        }
      }
    }
  }

  // Try leverage via create_order endpoint
  console.log('\n--- Try leverage via create_order endpoint ---');
  for (const action of actions) {
    for (const abi of abiVariations) {
      try {
        const cd = buildCD(action, abi.types, abi.values);
        const resp = await axios.post(BASE + '/hl/create_order', { computedData: cd }, { headers: HEADERS });
        console.log(`✅ ${action} → create_order ${abi.label}: ${JSON.stringify(resp.data).slice(0, 200)}`);
      } catch (e) {
        const status = e.response?.status;
        if (status === 400) {
          const data = JSON.stringify(e.response?.data).slice(0, 200);
          if (!data.includes('data out-of-bounds') && !data.includes('Invalid params')) {
            console.log(`⚠️  ${action} → create_order ${abi.label}: ${status} ${data}`);
          }
        }
      }
    }
  }

  // Also try: maybe it's part of the GDEX frontend APIs, not the HL managed custody flow
  console.log('\n--- Try GDEX frontend-style leverage endpoints ---');
  const frontendPaths = [
    '/hl/update_leverage', '/hl/change_leverage', '/hl/leverage/set',
    '/perp/leverage', '/perp/update_leverage', '/account/leverage',
    '/hl/margin_type', '/hl/update_margin',
  ];
  
  for (const p of frontendPaths) {
    // Try with computedData
    try {
      const cd = buildCD('hl_update_leverage', ['string', 'uint32', 'bool', 'string'], ['BTC', 50, true, n]);
      const resp = await axios.post(BASE + p, { computedData: cd }, { headers: HEADERS });
      console.log(`✅ POST ${p} (computedData): ${JSON.stringify(resp.data).slice(0, 200)}`);
    } catch (e) {
      if (e.response?.status !== 404) {
        console.log(`⚠️  POST ${p} (computedData): ${e.response?.status} ${JSON.stringify(e.response?.data).slice(0, 200)}`);
      }
    }
    // Try with plain JSON
    try {
      const resp = await axios.post(BASE + p, {
        address: wallet.address.toLowerCase(),
        coin: 'BTC', leverage: 50, isCross: true,
      }, { headers: HEADERS });
      console.log(`✅ POST ${p} (json): ${JSON.stringify(resp.data).slice(0, 200)}`);
    } catch (e) {
      if (e.response?.status !== 404) {
        console.log(`⚠️  POST ${p} (json): ${e.response?.status} ${JSON.stringify(e.response?.data).slice(0, 200)}`);
      }
    }
  }

  console.log('\nDone probing');
})().catch(e => console.error('Fatal:', e.message));
