---
name: gdex-hl-outcomes
description: HyperLiquid HIP-3 outcome / event markets — list markets, place outcome orders, and manage outcome positions
---

# GDEX: HyperLiquid Outcomes (HIP-3 Event Markets)

Trade discrete-outcome event markets running on HyperLiquid HIP-3 permissioned
perp DEXes. These are prediction-market-style instruments where each market
resolves to a discrete outcome rather than a continuous price.

## When to Use

- Listing the currently open / resolved outcome markets
- Getting an account state on an outcomes perp dex
- Opening, cancelling, or closing positions on an outcome market

## Prerequisites

- `@gdexsdk/gdex-skill` installed
- Authenticated via managed custody — see **gdex-authentication**
- Trading enabled on HL (one-time `/v1/hl/enable_trading`) — see
  **gdex-perp-trading** for the HIP-3 setup flow
- For write operations: a pre-built `computedData` payload built by the
  caller using the standard managed-custody encrypted-payload contract
  (ABI schemas for outcome actions live in
  `src/api/services/ServiceHyperLiquid.ts` of the backend)

## Backend Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/v1/hl/outcomes` | List outcome markets |
| `GET`  | `/v1/hl/outcome_account` | Account state on outcomes dex |
| `POST` | `/v1/hl/outcome/create_order` | Open an outcome order |
| `POST` | `/v1/hl/outcome/cancel_order` | Cancel an outcome order |
| `POST` | `/v1/hl/outcome/close_order` | Close an outcome position |

All read endpoints accept an optional `dex` query parameter to target a
specific HIP-3 perp dex registered via `/v1/hl/perp_dexes`.

## SDK Usage

```typescript
import { GdexSkill } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(process.env.GDEX_API_KEY!);

// List markets
const markets = await skill.getHlOutcomes({ status: 'open' });

// Account state
const state = await skill.getHlOutcomeAccount({
  userAddress: '0xWallet',
  dex: 'outcomes-dex-id',
});

// Open a position (caller pre-builds computedData)
const order = await skill.createHlOutcomeOrder({
  computedData,
  dex: 'outcomes-dex-id',
});
```

## Notes

- Outcome markets are distinct from the default HyperLiquid perp engine —
  they use a separate clearinghouse (use `swap_collateral` via the
  **gdex-perp-funding** skill to move USDC between them).
- Order schemas are not standardised across HIP-3 deployments; consult the
  backend service for the exact `actionParams` ABI per outcome dex.
