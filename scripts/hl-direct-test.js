/**
 * Test HL ExchangeClient directly to understand error format.
 * Use our control wallet (0x53D029...) to try HL exchange actions.
 */
const { Wallet } = require('ethers');

(async () => {
  // Dynamic import for ESM modules
  const HL = await import('@nktkas/hyperliquid');
  
  const mnemonic = 'airport room shoe add offer price divide sell make army say celery';
  const wallet = Wallet.fromPhrase(mnemonic);
  const managedAddr = '0x9967179de55bd67e6b90fcc4f908556d93938c0f';
  
  console.log('Control wallet:', wallet.address);
  console.log('Private key available:', !!wallet.privateKey);
  
  // Check managed wallet state on HL
  const infoTransport = new HL.HttpTransport();
  const info = new HL.InfoClient({ transport: infoTransport });
  
  const state = await info.clearinghouseState({ user: managedAddr });
  console.log('\nManaged wallet state:');
  console.log('  Account value:', state.crossMarginSummary.accountValue);
  console.log('  Margin used:', state.crossMarginSummary.totalMarginUsed);
  console.log('  Withdrawable:', state.withdrawable);
  console.log('  Positions:', state.assetPositions.length);
  
  // Get meta for asset info
  const meta = await info.meta();
  const btcMeta = meta.universe.find(u => u.name === 'BTC');
  const ethMeta = meta.universe.find(u => u.name === 'ETH');
  console.log('\nBTC meta:', JSON.stringify(btcMeta));
  console.log('ETH meta:', JSON.stringify(ethMeta));
  
  // Find BTC asset index
  const btcIndex = meta.universe.findIndex(u => u.name === 'BTC');
  console.log('BTC index:', btcIndex);
  
  // Check if ExchangeClient exists and what it accepts
  console.log('\nHL exports:', Object.keys(HL).join(', '));
  
  // Try creating an ExchangeClient with our control wallet
  // Even though we have no HL balance on control wallet,
  // we can test the API format
  if (HL.ExchangeClient) {
    console.log('\nExchangeClient available');
    
    try {
      const exchangeTransport = new HL.HttpTransport();
      const exchange = new HL.ExchangeClient({
        wallet: wallet,
        transport: exchangeTransport,
      });
      
      console.log('ExchangeClient created');
      
      // Try updateLeverage on BTC (this might work even without balance)
      try {
        console.log('\n--- Test: updateLeverage BTC 40x cross ---');
        const levResult = await exchange.updateLeverage({
          asset: btcIndex,
          isCross: true,
          leverage: 40,
        });
        console.log('Leverage result:', JSON.stringify(levResult));
      } catch (e) {
        console.log('Leverage error:', e.message);
        if (e.response) console.log('Response:', JSON.stringify(e.response).slice(0, 500));
      }
      
      // Try approveBuilderFee
      try {
        console.log('\n--- Test: approveBuilderFee ---');
        const approveResult = await exchange.approveBuilderFee({
          maxFeeRate: '0.1%',
          builder: '0x1bd80b4165CEED7F9404f8D59dFD3A8fA5d445E7',
        });
        console.log('Approve result:', JSON.stringify(approveResult));
      } catch (e) {
        console.log('Approve error:', e.message);
        if (e.response) console.log('Response:', JSON.stringify(e.response).slice(0, 500));
      }
      
      // Try placing an order to see the error format
      try {
        console.log('\n--- Test: order (expect failure - no balance) ---');
        const orderResult = await exchange.order({
          orders: [{
            a: btcIndex,
            b: true,
            p: '60000',
            s: '0.0002',
            r: false,
            t: { limit: { tif: 'Gtc' } },
          }],
          grouping: 'na',
        });
        console.log('Order result:', JSON.stringify(orderResult));
      } catch (e) {
        console.log('Order error:', e.message);
        if (e.response) console.log('Response:', JSON.stringify(e.response).slice(0, 500));
        // Show raw error
        console.log('Error details:', JSON.stringify({
          name: e.name,
          code: e.code,
          data: e.data,
          status: e.status,
        }));
      }
      
    } catch (e) {
      console.log('ExchangeClient creation error:', e.message);
    }
  } else {
    console.log('ExchangeClient NOT available in @nktkas/hyperliquid');
    console.log('Available:', Object.keys(HL));
  }
  
  console.log('\nDone');
})().catch(e => {
  console.error('Fatal:', e.message);
  console.error(e.stack);
});
