# Gemach Agent Demo (GDEX)

A reference UI that drives a full agent trading flow on HyperLiquid through the shipped
`@gdexsdk/gdex-skill` SDK, in full **Gemach branding** (see `assets/brand` and the
`gdex-ui-theming` skill). Built to be screen-recorded.

**The flow (all live):** open leverage position → close → place limit leverage order →
cancel → move collateral on HyperLiquid (USDC⇄USDH swap) → outcome order → outcome limit
order → close, on the live CPI HIP-3 prediction market.

## Layout

- `server/` — Express + the SDK. Signs in with managed custody on boot, exposes
  `GET /api/state` (live HL state) and `POST /api/step/:name` (one flow leg). Serves the UI.
- `web/` — Vite + React dashboard using the `gdex-ui-*` skill component patterns and the
  Gemach theme tokens. One "Run full demo" button steps through the flow.
- `record/` — Playwright script that drives the flow and records a `.webm`.

## Run it

> Executes **real trades** with real funds. Use a test wallet you control.

```bash
# 1. A wallet JSON with control + managed (Arbitrum/HyperLiquid) keys.
#    Default path: ~/gdex-test-wallet.json  (override with GDEX_WALLET=/path/to.json)
#    Shape: { "control": { "address", "privateKey" },
#             "managed": { "Arbitrum (HyperLiquid)": { "address" } } }
#    Fund the HL account (perp + spot USDC). See the gdex-perp-funding skill.

# 2. Backend (installs the SDK from GitHub, signs in, serves the built UI)
cd server && npm install && cd ..
cd web && npm install && npm run build && cd ..
cd server && npm start                 # http://localhost:4317

# 3. (optional) Record a video
cd record && npm install && node record.mjs   # -> record/out/*.webm
```

Convert the `.webm` to mp4/gif with any full ffmpeg build.

## Notes

- Perp legs need margin in the HL **perp** account; outcome legs settle via **spot** USDC.
  The CPI market book can be thin — this demo uses resting limit orders for the outcome
  legs (real orders) to stay reliable; market fills work too (see `gdex-hl-outcomes`).
- The shared API key is public by design (`SECURITY.md`); supply your own via `GDEX_API_KEY`
  for production.
