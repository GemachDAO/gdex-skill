/**
 * Probe for hidden/initialization endpoints that might be needed before trading.
 */
const axios = require('axios');
const BASE = 'https://trade-api.gemach.io/v1';
const apiKey = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Accept': 'application/json',
  'Authorization': `Bearer ${apiKey}`,
};

(async () => {
  const endpoints = [
    // Setup/init endpoints
    ['POST', '/hl/setup'],
    ['POST', '/hl/initialize'],
    ['POST', '/hl/init'],
    ['POST', '/hl/create_wallet'],
    ['POST', '/hl/create_account'],
    ['POST', '/hl/activate'],
    ['POST', '/hl/enable_trading'],
    ['POST', '/hl/approve_builder'],
    ['POST', '/hl/approve_agent'],
    ['POST', '/hl/set_leverage'],
    ['POST', '/hl/set_max_leverage'],
    ['POST', '/hl/register'],
    
    // Account management
    ['GET', '/hl/account'],
    ['GET', '/hl/wallet'],
    ['GET', '/hl/balance'],
    ['POST', '/hl/balance'],
    ['GET', '/hl/positions'],
    ['POST', '/hl/positions'],
    
    // General API
    ['GET', '/api/config'],
    ['GET', '/config'],
    ['GET', '/v1'],
    ['GET', '/'],
    ['GET', '/docs'],
    ['GET', '/api-docs'],
    ['GET', '/swagger'],
    
    // NATS-mapped commands (common patterns)
    ['POST', '/hl/transfer'],
    ['POST', '/hl/trade'],
    ['POST', '/hl/market_order'],
    ['POST', '/hl/limit_order'],
    ['POST', '/hl/close_position'],
    ['POST', '/hl/modify_order'],
    
    // User management
    ['POST', '/user'],
    ['GET', '/user'],
    ['POST', '/user/settings'],
    ['GET', '/user/settings'],
    ['POST', '/user/config'],
    
    // Copy trade/bot related
    ['POST', '/hl/copy_trade'],
    ['POST', '/hl/bot'],
    ['GET', '/hl/traders'],
    ['POST', '/hl/follow'],
  ];

  console.log('Probing', endpoints.length, 'endpoints...\n');
  
  const found = [];
  for (const [method, endpoint] of endpoints) {
    try {
      const resp = method === 'GET'
        ? await axios.get(BASE + endpoint, { headers: HEADERS, timeout: 5000 })
        : await axios.post(BASE + endpoint, {}, { headers: HEADERS, timeout: 5000 });
      found.push({ method, endpoint, status: resp.status, data: JSON.stringify(resp.data).slice(0, 150) });
      console.log(`✅ ${method} ${endpoint}: ${resp.status} ${JSON.stringify(resp.data).slice(0, 150)}`);
    } catch (e) {
      if (e.response) {
        const s = e.response.status;
        if (s !== 404) {
          found.push({ method, endpoint, status: s, data: JSON.stringify(e.response.data).slice(0, 150) });
          console.log(`❓ ${method} ${endpoint}: ${s} ${JSON.stringify(e.response.data).slice(0, 150)}`);
        }
      }
    }
  }
  
  console.log('\n=== Non-404 Endpoints Found ===');
  for (const f of found) {
    console.log(`${f.method} ${f.endpoint}: ${f.status}`);
  }
  
  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
