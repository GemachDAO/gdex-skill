---
name: gdex-token-import
description: Import user-defined custom tokens so they appear in token details, balances, and portfolio across the platform
---

# GDEX: Token Import

Register a user-defined custom token so it is recognised by the backend's
token-details, balances, and portfolio endpoints. Useful for long-tail tokens
that are not yet indexed.

## When to Use

- A user wants to see a brand-new (or otherwise un-indexed) token in their
  portfolio or token-search results
- Pre-registering a token before launch so trading UI can resolve metadata

## Prerequisites

- `@gdexsdk/gdex-skill` installed
- Authenticated via shared API key or wallet sign-in — see
  **gdex-authentication**
- The token's on-chain address (contract address on EVM, mint address on
  Solana, object id on Sui)

## Backend Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/import_token` | Register a user-imported custom token |

## SDK Usage

```typescript
import { GdexSkill } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(process.env.GDEX_API_KEY!);

await skill.importToken({
  tokenAddress: '0xCustomToken',
  chain: 8453,
  symbol: 'CUSTOM',
  name: 'My Custom Token',
  decimals: 18,
  userId: '0xWallet',
  data: encryptedSessionKey,
});
```

## Notes

- `symbol`, `name`, and `decimals` are best-effort hints — the backend may
  override them with on-chain data when available.
- The backend deduplicates imports per `(userId, chain, tokenAddress)`.
- After import, queries such as `getTokenDetails`, `getBalances`, and
  `getPortfolio` will start returning data for the token (subject to
  indexer latency).
