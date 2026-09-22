const fs=require('fs'),os=require('os'),path=require('path');
const {ethers}=require('ethers');
const {GdexSkill,GDEX_API_KEY_PRIMARY,generateGdexSessionKeyPair,generateGdexNonce,buildGdexSignInMessage,buildGdexSignInComputedData}=require('./dist');
const axios=require('axios');
const W=JSON.parse(fs.readFileSync(path.join(os.homedir(),'gdex-test-wallet.json'),'utf8'));
const ctrl=W.control.address, managed=W.managed['Arbitrum (HyperLiquid)'].address;
const hl=b=>axios.post('https://api.hyperliquid.xyz/info',b,{headers:{'Content-Type':'application/json'}}).then(r=>r.data);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const D=e=>e.response?.data?JSON.stringify(e.response.data).slice(0,160):e.message;
async function pos(){const ch=await hl({type:'clearinghouseState',user:managed});return (ch.assetPositions||[]).map(p=>p.position);}
async function openOrders(){const o=await hl({type:'openOrders',user:managed});return o||[];}
async function mark(c){const m=await hl({type:'allMids'});return Number(m[c]);}
(async()=>{
  const s=new GdexSkill({timeout:60000,maxRetries:1}); s.loginWithApiKey(GDEX_API_KEY_PRIMARY);
  const w=new ethers.Wallet(W.control.privateKey); const kp=generateGdexSessionKeyPair(); const n=generateGdexNonce().toString();
  const sig=await w.signMessage(buildGdexSignInMessage(ctrl,n,kp.sessionKey));
  const p=buildGdexSignInComputedData({apiKey:GDEX_API_KEY_PRIMARY,userId:ctrl,sessionKey:kp.sessionKey,nonce:n,signature:sig.replace(/^0x/,'')});
  await s.signInWithComputedData({computedData:p.computedData,chainId:1});
  const creds={apiKey:GDEX_API_KEY_PRIMARY,walletAddress:ctrl,sessionPrivateKey:kp.sessionPrivateKey};
  const px=await mark('BTC');
  console.log('BTC mark', px, '| start positions:', JSON.stringify(await pos()));

  // 0. Close any existing position (reduce-only market)
  let ps=await pos();
  if(ps.length){const e=ps[0];const sz=Math.abs(Number(e.szi));const isLong=Number(e.szi)>0;
    console.log('closing existing',e.coin,e.szi);
    try{const r=await s.hlCreateOrder({...creds,coin:e.coin,isLong:!isLong,price:String(px),size:String(sz),isMarket:true,reduceOnly:true});console.log(' close:',JSON.stringify(r).slice(0,120));}catch(e){console.log(' close ERR',D(e));}
    await sleep(4000);}
  console.log('after close positions:', JSON.stringify(await pos()));

  // 1. set leverage (best-effort)
  try{const r=await s.hlUpdateLeverage({...creds,coin:'BTC',leverage:10,isCross:true});console.log('leverage10:',JSON.stringify(r).slice(0,100));}catch(e){console.log('leverage ERR (non-fatal)',e.response?.status);}

  // 2. open BTC long market ~$11
  const size=(11/px).toFixed(5);
  console.log('\nOPEN long',size,'BTC (~$11)');
  try{const r=await s.hlCreateOrder({...creds,coin:'BTC',isLong:true,price:String(px),size,isMarket:true});console.log(' open:',JSON.stringify(r).slice(0,160));}catch(e){console.log(' open ERR',D(e));}
  await sleep(4000);
  console.log(' position:',JSON.stringify(await pos()));

  // 3. resting limit (buy below mark, won't fill)
  const lpx=(px*0.95).toFixed(0);
  console.log('\nLIMIT buy',size,'@',lpx);
  let oid;
  try{const r=await s.hlCreateOrder({...creds,coin:'BTC',isLong:true,price:lpx,size,isMarket:false});console.log(' limit:',JSON.stringify(r).slice(0,180));const m=JSON.stringify(r).match(/"oid":(\d+)/);if(m)oid=m[1];}catch(e){console.log(' limit ERR',D(e));}
  await sleep(3000);
  console.log(' open orders:',JSON.stringify((await openOrders()).map(o=>({coin:o.coin,px:o.limitPx,sz:o.sz,oid:o.oid}))));

  // 4. cancel limit
  if(oid){console.log('\nCANCEL oid',oid);try{const r=await s.hlCancelOrder({...creds,coin:'BTC',orderId:String(oid)});console.log(' cancel:',JSON.stringify(r).slice(0,120));}catch(e){console.log(' cancel ERR',D(e));}await sleep(2500);}
  console.log(' open orders after cancel:',(await openOrders()).length);

  // 5. close position
  ps=await pos();
  if(ps.length){const e=ps[0];const sz=Math.abs(Number(e.szi));
    console.log('\nCLOSE position',sz);
    try{const r=await s.hlCreateOrder({...creds,coin:'BTC',isLong:false,price:String(px),size:String(sz),isMarket:true,reduceOnly:true});console.log(' close:',JSON.stringify(r).slice(0,120));}catch(e){console.log(' close ERR',D(e));}
    await sleep(4000);}
  console.log(' final positions:',JSON.stringify(await pos()));
  console.log('\nPERP REAL TEST DONE');
  process.exit(0);
})().catch(e=>{console.error('FATAL',D(e));process.exit(1);});
