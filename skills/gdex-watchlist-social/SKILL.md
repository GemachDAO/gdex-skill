---
name: gdex-watchlist-social
description: Watchlist, comments, and sentiment voting — social community features around individual tokens
---

# GDEX: Watchlist & Social

Manage a per-user watchlist and interact with the social layer around each
token (comments and bullish/bearish sentiment votes).

## When to Use

- Letting a user pin tokens for quick access
- Reading or posting comments on a token's page
- Voting bullish / bearish on a token

## Prerequisites

- `@gdexsdk/gdex-skill` installed
- Authenticated via shared API key or wallet sign-in — see
  **gdex-authentication**
- For write operations: a session-key authentication context (`userId` and
  encrypted `data` payload) or a managed-custody token, depending on
  backend deployment

## Backend Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/v1/watch_list` | Get the user's watchlist |
| `POST` | `/v1/change_watch_list` | Add or remove a token from the watchlist |
| `GET`  | `/v1/comments` | Get comments for a token |
| `POST` | `/v1/add_comment` | Post a comment |
| `POST` | `/v1/vote_sentiment` | Cast a bullish/bearish sentiment vote |

## SDK Usage

```typescript
import { GdexSkill } from '@gdexsdk/gdex-skill';

const skill = new GdexSkill();
skill.loginWithApiKey(process.env.GDEX_API_KEY!);

// Watchlist
const list = await skill.getWatchList({ userId: '0xWallet', data: encryptedSessionKey });
await skill.changeWatchList({
  tokenAddress: '0xToken',
  chain: 8453,
  action: 'add',
  userId: '0xWallet',
  data: encryptedSessionKey,
});

// Comments
const comments = await skill.getComments({ tokenAddress: '0xToken', chain: 8453 });
await skill.addComment({
  tokenAddress: '0xToken',
  chain: 8453,
  message: 'Looking strong on the 4h',
  userId: '0xWallet',
  data: encryptedSessionKey,
});

// Sentiment
await skill.voteSentiment({
  tokenAddress: '0xToken',
  chain: 8453,
  sentiment: 'bullish',
  userId: '0xWallet',
  data: encryptedSessionKey,
});
```

## Notes

- Watchlist entries are scoped to `(userId, chain, tokenAddress)`.
- Sentiment votes are deduplicated per `(userId, tokenAddress)` — re-voting
  updates the existing vote.
- Comment moderation policies (rate limits, profanity filters) are enforced
  server-side; expect API errors when limits are hit.
