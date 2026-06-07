/* Express server: serves the built UI and exposes the demo flow as /api endpoints. */
const path = require('path');
const express = require('express');
const cors = require('cors');
const ex = require('./executor');

const PORT = process.env.PORT || 4317;
const app = express();
app.use(cors());
app.use(express.json());

// The 8-step flow (matches the CLI test). Perp legs simulated; move + outcome live.
const STEPS = {
  'perp-open': () => ex.perpOpen(),
  'perp-close': () => ex.perpClose(),
  'perp-limit': () => ex.perpLimit(),
  'perp-cancel': () => ex.perpCancel(),
  'move-funds': () => ex.moveFunds({ amount: '11' }),
  'outcome-market': () => ex.outcomeOrder(),
  'outcome-limit': () => ex.outcomeLimitOrder(),
  'outcome-close': () => ex.outcomeCancelAll(),
};

app.get('/api/state', async (_req, res) => {
  try { res.json(await ex.refreshState()); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/step/:name', async (req, res) => {
  const step = STEPS[req.params.name];
  if (!step) return res.status(404).json({ error: `unknown step ${req.params.name}` });
  try {
    const result = await step();
    const state = await ex.refreshState();
    res.json({ ok: true, result, state });
  } catch (e) {
    ex.logEvent('error', `${req.params.name} failed: ${e.response?.status || ''} ${e.message}`);
    res.status(200).json({ ok: false, error: e.message, state: ex.getState() });
  }
});

app.use(express.static(path.join(__dirname, '..', 'web', 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html')));

(async () => {
  console.log('Signing in to GDEX / HyperLiquid…');
  await ex.signIn();
  await ex.refreshState();
  app.listen(PORT, () => console.log(`GDEX demo server on http://localhost:${PORT}`));
})().catch((e) => { console.error('startup failed:', e.message); process.exit(1); });
