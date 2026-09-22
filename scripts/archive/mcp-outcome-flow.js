/* Verify the outcome-trade flow THROUGH the MCP server with structured params. */
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const { ethers } = require('ethers');
const {
  GdexSkill, GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair, generateGdexNonce,
  buildGdexSignInMessage, buildGdexSignInComputedData,
} = require('../../dist');

const W = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'gdex-test-wallet.json'), 'utf8'));
const apiKey = GDEX_API_KEY_PRIMARY, ctrl = W.control.address, wallet = new ethers.Wallet(W.control.privateKey);

(async () => {
  // 1. Sign in via SDK to obtain a backend-registered session key
  const s = new GdexSkill({ timeout: 60000, maxRetries: 1 });
  s.loginWithApiKey(apiKey);
  const kp = generateGdexSessionKeyPair(); const n = generateGdexNonce().toString();
  const sig = await wallet.signMessage(buildGdexSignInMessage(ctrl, n, kp.sessionKey));
  const p = buildGdexSignInComputedData({ apiKey, userId: ctrl, sessionKey: kp.sessionKey, nonce: n, signature: sig.replace(/^0x/, '') });
  await s.signInWithComputedData({ computedData: p.computedData, chainId: 1 });
  const spk = kp.sessionPrivateKey;
  console.log('signed in; driving MCP server with structured params...');

  // 2. Build MCP JSON-RPC calls (structured params — NO hand-built computedData)
  const calls = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '1' } } },
    { id: 2, method: 'tools/call', params: { name: 'hl_enable_trading', arguments: { apiKey, walletAddress: ctrl, sessionPrivateKey: spk } } },
    { id: 3, method: 'tools/call', params: { name: 'hl_create_outcome_order', arguments: { apiKey, walletAddress: ctrl, sessionPrivateKey: spk, outcomeId: '101', coin: '#1010', isBuy: true, price: '0.10', size: '110', isMarket: false } } },
    { id: 4, method: 'tools/call', params: { name: 'hl_outcome_account', arguments: { userAddress: '0x0405d2c012467cdf41b12010e15fa752e59fb40b', outcomeId: '101' } } },
  ];
  const input = calls.map((c) => JSON.stringify({ jsonrpc: '2.0', ...c })).join('\n') + '\n';

  const child = spawn('node', [__dirname + '/../../mcp-server/dist/index.js'], { env: { ...process.env, GDEX_API_KEY: apiKey } });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stdin.write(input);

  await new Promise((r) => setTimeout(r, 18000));

  // parse responses, find the created order oid
  let oid;
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const txt = d.result?.content?.[0]?.text || '';
    const names = { 2: 'hl_enable_trading', 3: 'hl_create_outcome_order', 4: 'hl_outcome_account' };
    if (names[d.id]) console.log(`MCP ${names[d.id]}: isError=${d.result?.isError} -> ${txt.slice(0, 130).replace(/\n/g, ' ')}`);
    const m = txt.match(/"oid":(\d+)/);
    if (d.id === 3 && m) oid = m[1];
  }

  // 3. Cancel via MCP
  if (oid) {
    const cancel = JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'hl_cancel_outcome_order', arguments: { apiKey, walletAddress: ctrl, sessionPrivateKey: spk, outcomeId: '101', coin: '#1010', orderId: oid } } }) + '\n';
    out = '';
    child.stdin.write(cancel);
    await new Promise((r) => setTimeout(r, 8000));
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      if (d.id === 5) console.log(`MCP hl_cancel_outcome_order: isError=${d.result?.isError} -> ${(d.result?.content?.[0]?.text||'').slice(0,120).replace(/\n/g,' ')}`);
    }
  } else { console.log('no oid captured from create'); }

  child.kill();
  console.log('\nMCP OUTCOME FLOW DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
