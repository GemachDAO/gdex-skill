#!/usr/bin/env node
/**
 * HL Copy Trade — Full Lifecycle E2E Test
 * Tests: sign-in → tx_list → list → create → verify → delete(isDelete) → verify → tx_list
 */
const {
  GdexSkill,
  GDEX_API_KEY_PRIMARY,
  generateGdexSessionKeyPair,
  buildGdexSignInMessage,
  buildGdexSignInComputedData,
  buildGdexUserSessionData,
  buildHlComputedData,
  Endpoints,
} = require('../dist/index.js');
const { ethers } = require('ethers');

const MNEMONIC = process.env.GDEX_MNEMONIC || 'airport room shoe add offer price divide sell make army say celery';
const API_KEY = process.env.GDEX_API_KEY || GDEX_API_KEY_PRIMARY;
const TRADER = '0x18c99bb72e9e2a2c13ae1a2c26e8dfaaed83b101';

(async () => {
  try {
    const skill = new GdexSkill({ apiKey: API_KEY });
    const wallet = ethers.Wallet.fromPhrase(MNEMONIC);
    const userId = wallet.address;
    console.log('[0] userId:', userId);

    // Sign in
    const { sessionPrivateKey, sessionKey } = generateGdexSessionKeyPair();
    const nonce = String(Date.now());
    const msg = buildGdexSignInMessage(wallet.address, nonce, sessionKey);
    const sig = await wallet.signMessage(msg);
    const payload = buildGdexSignInComputedData({ apiKey: API_KEY, userId: wallet.address, sessionKey, nonce, signature: sig });
    await skill.client.post(Endpoints.AUTH_SIGN_IN, { computedData: payload.computedData, chainId: 1 });
    console.log('[1] sign-in OK');

    const sessionData = buildGdexUserSessionData(sessionKey, API_KEY);

    // tx_list before
    try {
      const r = await skill.getHlCopyTradeTxList({ userId, data: sessionData, page: '1', limit: '10' });
      console.log('[2] tx_list:', JSON.stringify(r).slice(0, 500));
    } catch(e) { console.log('[2] tx_list FAILED:', e.message); }

    // list baseline
    const before = await skill.getHlCopyTradeList({ userId, data: sessionData });
    const beforeList = before.allCopyTrades || before.copyTrades || [];
    console.log('[3] existing count:', beforeList.length);

    // If there's an orphaned trade from a previous run, delete it first
    const orphan = beforeList.find(t => t.copyTradeName === 'E2E-Cycle');
    if (orphan) {
      console.log('  Cleaning up orphan:', orphan.copyTradeId);
      const cleanupRes = await skill.updateHlCopyTrade({
        userId, apiKey: API_KEY, sessionPrivateKey,
        copyTradeId: orphan.copyTradeId, traderWallet: TRADER,
        copyTradeName: 'E2E-Cycle', copyMode: 1,
        fixedAmountCostPerOrder: '10', lossPercent: '5', profitPercent: '10',
        isDelete: true, isChangeStatus: false, oppositeCopy: false,
      });
      console.log('  cleanup result:', JSON.stringify(cleanupRes));
      await new Promise(r => setTimeout(r, 1000));
    }

    // create
    let createRes;
    try {
      createRes = await skill.createHlCopyTrade({
        userId,
        apiKey: API_KEY,
        sessionPrivateKey,
        traderWallet: TRADER,
        copyTradeName: 'E2E-Cycle',
        copyMode: 1,
        fixedAmountCostPerOrder: '10',
        lossPercent: '5',
        profitPercent: '10',
        oppositeCopy: false,
      });
      console.log('[4] create:', JSON.stringify(createRes).slice(0, 500));
    } catch(e) {
      console.log('[4] create FAILED:', e.response?.status, e.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : e.message);
      // Try to find existing trade from list to continue testing delete
      const list = await skill.getHlCopyTradeList({ userId, data: sessionData });
      console.log('    existing list:', JSON.stringify(list).slice(0, 500));
      return;
    }

    // verify
    await new Promise(r => setTimeout(r, 2000)); // wait for consistency
    const afterCreate = await skill.getHlCopyTradeList({ userId, data: sessionData });
    console.log('[5] raw list response:', JSON.stringify(afterCreate).slice(0, 500));
    const afterList = afterCreate.allCopyTrades || afterCreate.copyTrades || [];
    console.log('[5] after create count:', afterList.length);
    // Also try extracting from create response
    const allFromCreate = createRes.allCopyTrades || [];
    const newTrade = afterList.find(t => t.copyTradeName === 'E2E-Cycle') || allFromCreate.find(t => t.copyTradeName === 'E2E-Cycle');
    if (!newTrade) { console.log('  ERROR: not found in either!'); return; }
    console.log('  copyTradeId:', newTrade.copyTradeId);
    console.log('  copyMode:', newTrade.copyMode, '(sent: 1)');
    console.log('  isActive:', newTrade.isActive);
    console.log('  all fields:', JSON.stringify(newTrade).slice(0, 500));

    // delete with isDelete=true
    const delRes = await skill.updateHlCopyTrade({
      userId,
      apiKey: API_KEY,
      sessionPrivateKey,
      copyTradeId: newTrade.copyTradeId,
      traderWallet: TRADER,
      copyTradeName: 'E2E-Cycle',
      copyMode: 1,
      fixedAmountCostPerOrder: '10',
      lossPercent: '5',
      profitPercent: '10',
      isDelete: true,
      isChangeStatus: false,
      oppositeCopy: false,
    });
    console.log('[6] delete result:', JSON.stringify(delRes));

    // verify deletion
    const afterDel = await skill.getHlCopyTradeList({ userId, data: sessionData });
    const afterDelList = afterDel.allCopyTrades || afterDel.copyTrades || [];
    console.log('[7] after delete count:', afterDelList.length);
    const stillExists = afterDelList.find(t => t.copyTradeId === newTrade.copyTradeId);
    console.log('  still exists?', !!stillExists);

    // tx_list after
    try {
      const r = await skill.getHlCopyTradeTxList({ userId, data: sessionData, page: '1', limit: '10' });
      console.log('[8] tx_list after:', JSON.stringify(r).slice(0, 500));
    } catch(e) { console.log('[8] tx_list FAILED:', e.message); }

    console.log('\n=== DONE ===');
  } catch(err) {
    console.log('FATAL:', err.response?.status, err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : err.message);
  }
})();
