/**
 * Live SDK test — Copy Trading (all 9 endpoints).
 *
 * Tests:
 *  1. getCopyTradeWallets()        — top 300 by PnL (no auth)
 *  2. getCopyTradeCustomWallets()  — top 300 by net received (no auth)
 *  3. getCopyTradeGems()           — hot tokens (no auth)
 *  4. getCopyTradeDexes(solana)    — supported DEXes (no auth)
 *  5. getCopyTradeList()           — user's configs (session-key auth)
 *  6. getCopyTradeTxList()         — tx history (session-key auth)
 *  7. createCopyTrade()            — create config (computedData auth)
 *  8. updateCopyTrade()            — toggle/delete (computedData auth)
 */
const { GdexSkill } = require('../dist');

const MNEMONIC = 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = '9b4e1c73-6a2f-4d88-b5c9-3e7a2f1d6c54';
const SOLANA = 622112261;

async function main() {
  const sdk = new GdexSkill({ apiKey: API_KEY });
  await sdk.loginWithApiKey(API_KEY);

  console.log('SDK initialized\n');

  // ── 1. Wallets by PnL ─────────────────────────────────────────────────
  try {
    const wallets = await sdk.getCopyTradeWallets();
    console.log(`✅ getCopyTradeWallets: ${wallets.length} wallets`);
    if (wallets[0]) {
      console.log(`   Top wallet: ${wallets[0].address}, PnL: $${wallets[0].totalPnl?.toFixed(2)}`);
      console.log(`   Keys: ${Object.keys(wallets[0]).join(', ')}`);
    }
  } catch (e) {
    console.log(`❌ getCopyTradeWallets: ${e.message}`);
  }

  // ── 2. Custom wallets (by net received) ───────────────────────────────
  try {
    const custom = await sdk.getCopyTradeCustomWallets();
    console.log(`✅ getCopyTradeCustomWallets: ${custom.length} wallets`);
    if (custom[0]) {
      console.log(`   Top wallet: ${custom[0].address}, Net: $${custom[0].receivedMinusSpent?.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`❌ getCopyTradeCustomWallets: ${e.message}`);
  }

  // ── 3. Gems ───────────────────────────────────────────────────────────
  try {
    const gems = await sdk.getCopyTradeGems();
    console.log(`✅ getCopyTradeGems: ${gems.length} gems`);
    if (gems[0]) {
      console.log(`   First gem:`, JSON.stringify(gems[0]).slice(0, 200));
    }
  } catch (e) {
    console.log(`❌ getCopyTradeGems: ${e.message}`);
  }

  // ── 4. DEXes ──────────────────────────────────────────────────────────
  try {
    const dexes = await sdk.getCopyTradeDexes(SOLANA);
    console.log(`✅ getCopyTradeDexes: ${dexes.dexes?.length} DEXes`);
    if (dexes.dexes) {
      for (const d of dexes.dexes.slice(0, 5)) {
        console.log(`   #${d.dexNumber} ${d.dexName} → ${d.programId}`);
      }
    }
  } catch (e) {
    console.log(`❌ getCopyTradeDexes: ${e.message}`);
  }

  // ── 5. List user copy trades (session-key auth) ───────────────────────
  // Need to be signed in with session key for this
  try {
    const { buildGdexUserSessionData } = require('../dist/utils/gdexManagedCrypto');
    // We need a session key — let's try to use the SDK's internal client
    // The session key is stored after loginWithApiKey
    const client = sdk.client;
    
    // Try to access the session data from the client
    // loginWithApiKey may set headers but not session keys for copy trade endpoints
    // Let's try with a dummy encrypted data to see if the route responds
    const sessionData = buildGdexUserSessionData(
      // Use a dummy compressed pubkey for testing route accessibility
      '0x' + '02' + 'a'.repeat(64),
      API_KEY
    );

    const list = await sdk.getCopyTradeList({
      userId: '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD',
      data: sessionData,
    });
    console.log(`✅ getCopyTradeList: ${list.count ?? 0} copy trades`);
    if (list.allCopyTrades?.length > 0) {
      const ct = list.allCopyTrades[0];
      console.log(`   First: "${ct.copyTradeName}" tracking ${ct.traderWallet}, active=${ct.isActive}`);
    }
    console.log(`   Full response keys: ${Object.keys(list).join(', ')}`);
  } catch (e) {
    console.log(`⚠️  getCopyTradeList: ${e.message?.slice(0, 200)}`);
  }

  // ── 6. Transaction history (session-key auth) ─────────────────────────
  try {
    const { buildGdexUserSessionData } = require('../dist/utils/gdexManagedCrypto');
    const sessionData = buildGdexUserSessionData(
      '0x' + '02' + 'a'.repeat(64),
      API_KEY
    );

    const txList = await sdk.getCopyTradeTxList({
      userId: '0x53D029a671bd1CF61a2fB1F4F6e4bD830BFBb2eD',
      data: sessionData,
    });
    console.log(`✅ getCopyTradeTxList: ${txList.count ?? 0} transactions`);
    if (txList.txes?.length > 0) {
      const tx = txList.txes[0];
      console.log(`   First tx: ${tx.isBuy ? 'BUY' : 'SELL'} ${tx.tokenInfo?.symbol}, PnL: ${tx.pnlPercentage}%`);
    }
    console.log(`   Full response keys: ${Object.keys(txList).join(', ')}`);
  } catch (e) {
    console.log(`⚠️  getCopyTradeTxList: ${e.message?.slice(0, 200)}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n=== Discovery endpoints (no auth) all tested ===');
  console.log('=== Session-key endpoints tested (may fail with dummy key — expected) ===');
  console.log('=== Write endpoints (create/update) not live-tested to avoid creating real trades ===');
}

main().catch(e => console.error('FATAL:', e));
