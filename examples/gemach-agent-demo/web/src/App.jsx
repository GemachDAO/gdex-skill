import React, { useCallback, useEffect, useRef, useState } from 'react';

const STEPS = [
  { id: 'perp-open', label: 'Open leverage position', sub: 'BTC long · market · 10×', tag: 'live' },
  { id: 'perp-close', label: 'Close leverage position', sub: 'market close', tag: 'live' },
  { id: 'perp-limit', label: 'Place limit leverage order', sub: 'BTC long · resting bid', tag: 'live' },
  { id: 'perp-cancel', label: 'Cancel limit order', sub: 'remove resting order', tag: 'live' },
  { id: 'move-funds', label: 'Move collateral on HyperLiquid', sub: 'USDC ⇄ USDH swap', tag: 'live' },
  { id: 'outcome-market', label: 'Outcome order', sub: 'CPI "Below 4.3%" · Yes · limit buy', tag: 'live' },
  { id: 'outcome-limit', label: 'Outcome limit order', sub: 'resting bid · CPI Yes', tag: 'live' },
  { id: 'outcome-close', label: 'Close outcome orders', sub: 'cancel resting orders', tag: 'live' },
];

const fmtUsd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—');

function Flashing({ value, render }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== value) { setFlash(true); prev.current = value; const t = setTimeout(() => setFlash(false), 1000); return () => clearTimeout(t); }
  }, [value]);
  return <span className={flash ? 'v flash' : 'v'}>{render(value)}</span>;
}

export default function App() {
  const [state, setState] = useState(null);
  const [active, setActive] = useState(-1);
  const [done, setDone] = useState(-1);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const poll = useCallback(async () => {
    try { const r = await fetch('/api/state'); if (r.ok) setState(await r.json()); } catch (_) {}
  }, []);

  useEffect(() => { poll(); const id = setInterval(poll, 1500); return () => clearInterval(id); }, [poll]);

  const runAll = useCallback(async () => {
    if (running) return;
    setRunning(true); setFinished(false); setDone(-1);
    for (let i = 0; i < STEPS.length; i++) {
      setActive(i);
      try {
        const r = await fetch('/api/step/' + STEPS[i].id, { method: 'POST' });
        const data = await r.json();
        if (data.state) setState(data.state);
      } catch (_) {}
      await poll();
      setDone(i);
      await new Promise((res) => setTimeout(res, 1400));
    }
    setActive(-1); setRunning(false); setFinished(true);
  }, [running, poll]);

  // expose for Playwright determinism
  useEffect(() => { window.__demoFinished = finished; }, [finished]);

  const perpPositions = state?.perp?.positions || [];
  const perpOrders = state?.perp?.openOrders || [];
  const outOrders = state?.outcome?.openOrders || [];
  const spot = state?.spot || {};
  const log = state?.log || [];

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark"><img src="/lion.png" alt="Gemach" /></div>
          <div>
            <h1><span className="word">GDEX</span> <span style={{ color: 'var(--text-tertiary)', fontWeight: 500, letterSpacing: 0 }}>· Agent Trading</span></h1>
            <div className="sub">by Gemach · HyperLiquid perps · HIP-3 outcome markets · managed custody</div>
          </div>
        </div>
        <div className="header-right">
          <div className="chip price">BTC <b>{fmtUsd(state?.prices?.BTC)}</b></div>
          <div className="chip"><span className="dot" />{short(state?.control)}</div>
        </div>
      </header>

      <div className="grid">
        {/* LEFT — balances + order ticket */}
        <div>
          <div className="card">
            <h2>HyperLiquid Balances</h2>
            <div className="stat-row">
              <span className="k">Perp account</span>
              <Flashing value={state?.perp?.accountValue} render={(v) => fmtUsd(v)} />
            </div>
            <div className="stat-row">
              <span className="k">Spot · USDC</span>
              <Flashing value={spot.USDC} render={(v) => fmtUsd(v)} />
            </div>
            <div className="stat-row">
              <span className="k">Spot · USDH</span>
              <Flashing value={spot.USDH || 0} render={(v) => Number(v || 0).toFixed(2) + ' USDH'} />
            </div>
          </div>

          <div className="card">
            <h2>Perp Order · BTC</h2>
            <div className="side-toggle">
              <button className="long active">Long</button>
              <button className="short">Short</button>
            </div>
            <div className="field">
              <label>Size (USD)</label>
              <div className="input">50.00</div>
            </div>
            <div className="field">
              <label>Leverage</label>
              <div className="lev-track"><div className="lev-fill" style={{ width: '20%' }} /></div>
              <div className="lev-label"><span>1×</span><span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>10×</span><span>50×</span></div>
            </div>
          </div>
        </div>

        {/* CENTER — positions + orders */}
        <div>
          <div className="card">
            <h2>Open Positions</h2>
            <table>
              <thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>PnL</th><th>Lev</th></tr></thead>
              <tbody>
                {perpPositions.map((p, i) => (
                  <tr key={i}>
                    <td>{p.coin}-PERP <span className="pill live">live</span></td>
                    <td className={p.side === 'long' ? 'long-txt' : 'short-txt'}>{p.side.toUpperCase()}</td>
                    <td>{fmtUsd(p.notional)}</td>
                    <td>{fmtUsd(p.entry)}</td>
                    <td>{fmtUsd(state?.prices?.BTC)}</td>
                    <td className={(p.pnl || 0) >= 0 ? 'pos' : 'neg'}>{(p.pnl || 0) >= 0 ? '+' : ''}{fmtUsd(p.pnl)}</td>
                    <td>{p.leverage}×</td>
                  </tr>
                ))}
                {!perpPositions.length && <tr><td colSpan="7" className="muted">No open positions</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Open Orders</h2>
            <table>
              <thead><tr><th>Market</th><th>Type</th><th>Side</th><th>Price</th><th>Size</th></tr></thead>
              <tbody>
                {perpOrders.map((o, i) => (
                  <tr key={'p' + i}>
                    <td>{o.coin}-PERP <span className="pill live">live</span></td>
                    <td>Limit</td>
                    <td className={o.side === 'B' ? 'long-txt' : 'short-txt'}>{o.side === 'B' ? 'BUY' : 'SELL'}</td>
                    <td>{fmtUsd(o.px)}</td>
                    <td>{o.sz}</td>
                  </tr>
                ))}
                {outOrders.map((o, i) => (
                  <tr key={'o' + i}>
                    <td>CPI Yes <span className="pill live">live</span></td>
                    <td>Limit</td>
                    <td className="long-txt">BUY</td>
                    <td>{Number(o.px).toFixed(3)}</td>
                    <td>{o.sz}</td>
                  </tr>
                ))}
                {!perpOrders.length && !outOrders.length && <tr><td colSpan="5" className="muted">No open orders</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT — flow runner + activity */}
        <div>
          <div className="card">
            <h2>Agent Flow · 8 steps</h2>
            <button className="runbtn" onClick={runAll} disabled={running} data-testid="run-demo">
              {running ? 'Running flow…' : finished ? 'Replay flow' : '▶  Run full demo'}
            </button>
            <div>
              {STEPS.map((s, i) => (
                <div key={s.id} className={'step' + (i === active ? ' active' : '') + (i <= done ? ' done' : '')}>
                  <div className="num">{i <= done ? '✓' : i + 1}</div>
                  <div className="label">{s.label}<small>{s.sub}</small></div>
                  {i === active ? <div className="spin" /> : <span className={'pill ' + s.tag}>{s.tag}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Activity {finished && <span style={{ color: 'var(--color-long)' }} data-testid="done">· complete</span>}</h2>
            <div className="log">
              {log.slice(0, 12).map((e, i) => (
                <div className="log-item" key={e.ts + '-' + i}>
                  <span className={'tag ' + e.kind}>{e.kind}</span>
                  <span className="msg" dangerouslySetInnerHTML={{ __html: e.message.replace(/(\$[\d,.]+|[\d.]+ USD[CH]|oid \d+|\d+×)/g, '<b>$1</b>') }} />
                </div>
              ))}
              {!log.length && <div className="muted">Waiting for sign-in…</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
