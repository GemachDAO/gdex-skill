const axios = require('axios');
const { ethers } = require('ethers');

const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
const wallet = ethers.Wallet.fromPhrase(mnemonic);
const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
const controlAddr = wallet.address;
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const BASE = 'https://trade-api.gemach.io/v1';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Authorization': `Bearer ${apiKey}`,
};

async function main() {
  console.log('Control wallet:', controlAddr);
  console.log('Managed wallet:', managedAddr);

  // Check HL clearinghouse state with correct params
  console.log('\n=== HL Clearinghouse State (managed) ===');
  try {
    const resp = await axios.get(BASE + '/hl/clearinghouse_state', {
      params: { address: managedAddr },
      headers: HEADERS,
    });
    console.log('Response:', JSON.stringify(resp.data).slice(0, 500));
  } catch (e) {
    console.log('Error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
  }

  console.log('\n=== HL Clearinghouse State (control) ===');
  try {
    const resp = await axios.get(BASE + '/hl/clearinghouse_state', {
      params: { address: controlAddr },
      headers: HEADERS,
    });
    console.log('Response:', JSON.stringify(resp.data).slice(0, 500));
  } catch (e) {
    console.log('Error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
  }

  // Check HL open orders
  console.log('\n=== HL Open Orders (managed) ===');
  try {
    const resp = await axios.get(BASE + '/hl/open_orders', {
      params: { address: managedAddr },
      headers: HEADERS,
    });
    console.log('Response:', JSON.stringify(resp.data).slice(0, 500));
  } catch (e) {
    console.log('Error:', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 300));
  }

  // Check ETH balance on multiple chains
  const chains = [
    { name: 'Ethereum', rpc: 'https://eth.llamarpc.com' },
    { name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc' },
    { name: 'Base', rpc: 'https://mainnet.base.org' },
    { name: 'Polygon', rpc: 'https://polygon-rpc.com' },
    { name: 'BSC', rpc: 'https://bsc-dataseed1.binance.org' },
    { name: 'Optimism', rpc: 'https://mainnet.optimism.io' },
  ];

  // USDC addresses per chain
  const usdcAddresses = {
    'Ethereum': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    'Arbitrum': '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    'Base': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'Polygon': '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    'BSC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    'Optimism': '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  };

  const balanceOfSelector = '0x70a08231000000000000000000000000';

  for (const addr of [controlAddr, managedAddr]) {
    console.log(`\n=== Balances for ${addr.slice(0, 10)}... ===`);
    for (const chain of chains) {
      try {
        // ETH balance
        const ethResp = await axios.post(chain.rpc, {
          jsonrpc: '2.0', method: 'eth_getBalance',
          params: [addr, 'latest'], id: 1,
        }, { timeout: 5000 });
        const ethBal = parseInt(ethResp.data.result, 16) / 1e18;
        
        // USDC balance
        let usdcBal = 0;
        const usdc = usdcAddresses[chain.name];
        if (usdc) {
          const calldata = balanceOfSelector + addr.slice(2).padStart(64, '0');
          const usdcResp = await axios.post(chain.rpc, {
            jsonrpc: '2.0', method: 'eth_call',
            params: [{ to: usdc, data: calldata }, 'latest'], id: 2,
          }, { timeout: 5000 });
          const decimals = chain.name === 'BSC' ? 18 : 6;
          usdcBal = parseInt(usdcResp.data.result, 16) / (10 ** decimals);
        }
        
        if (ethBal > 0 || usdcBal > 0) {
          console.log(`  ${chain.name}: ETH=${ethBal.toFixed(6)}, USDC=${usdcBal.toFixed(2)}`);
        }
      } catch (e) {
        // Skip failed chains
      }
    }
  }
}

main().catch(e => console.error('Fatal:', e));
