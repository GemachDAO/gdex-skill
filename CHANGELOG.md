# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [4.3.0] - 2026-06-07

### Added

- **One-command MCP auto-config, no npm account required.**
  `npx -y github:GemachDAO/gdex-skill gdex-mcp-server init --client <claude|cursor|vscode|codex|opencode>`
  writes the agent's MCP config wired to launch the 116-tool server straight from GitHub
  with the shared API key. The root package now exposes the `gdex-mcp-server` bin and its
  `prepare` builds the MCP server, so the whole MCP stack ships from one GitHub install.
- `SECURITY.md` documenting the shared-key-by-design model, the build-on-install
  (`prepare`) flag, and the upstream-only transitive advisories.

### Changed

- MCP `init` now targets the GitHub source instead of the unpublished
  `@gdexsdk/mcp-server` npm package, and injects `GDEX_API_KEY` into the generated config.

### Removed

- The cosmetic `postinstall` banner script (flagged by supply-chain scanners as an
  install script; provided no functionality).

## [4.2.0] - 2026-06-07

### Changed

- **skills.sh now installs all 27 skills individually** instead of one umbrella skill.
  Removed the root `SKILL.md` (which made the skills CLI treat the whole repo as a
  single `gdex-trading` skill) so `npx skills add GemachDAO/gdex-skill` discovers each
  skill (`gdex-spot-trading`, `gdex-perp-trading`, …) as a separate, installable unit.
- The root skill's live-tested operational playbook (backend param quirks, endpoints
  that don't work, HL signature/error codes, E2E results) was migrated into
  `gdex-onboarding` so nothing is lost.

### Added

- `skills.sh.json` manifest grouping the 27 skills into categories for the skills.sh
  listing (Getting Started, Trading, Data & Discovery, Copy Trading & Bridge, …).

## [4.1.1] - 2026-06-07

### Fixed

- The SDK is now installable directly from GitHub: added a `prepare` script so
  `npm install github:GemachDAO/gdex-skill` builds `dist/` on install. Previously
  `dist/` was gitignored and there was no build-on-install hook, so a GitHub install
  produced no runnable build. Install docs updated (the package was never published
  to the npm registry, so the old `npm install @gdexsdk/gdex-skill` line did not work).

## [4.1.0] - 2026-06-06

### Added

- `scripts/archive/gen-fund-wallet.js` — generates a fresh control wallet via the
  SDK, signs in per chain, and prints the managed-custody deposit addresses to fund.
- `tests/utils/apiAliases.test.ts` — covers numeric and string-alias chain mapping.
- `toBackendSlippage` helper (`src/utils/slippage.ts`) + tests.
- HyperLiquid outcome-market (HIP-3) write support. `hlEnableTrading`, `hlSwapCollateral`,
  `createHlOutcomeOrder`, `cancelHlOutcomeOrder`, and `closeHlOutcomeOrder` now build the
  encrypted `computedData` from structured params (previously every outcome write required
  a hand-built payload with no SDK builder). Adds the `hl_enable_trading`, `hl_swap_token`,
  `hl_outcome_create_order`, `hl_outcome_cancel_order`, and `hl_outcome_close_order` ABI
  encoders to `encodeHlActionData`, plus round-trip tests. Live-verified end to end
  (enable_trading → resting outcome order → cancel).

### Changed

### Fixed

- `generateGdexNonce` now returns a strictly-increasing millisecond nonce. The old
  `floor(Date.now()/1000) + random(1000)` scheme collided constantly when several
  managed-custody actions were sent within the same second (rapid trade sequences),
  causing the backend to reject them as "Invalid params" (reused nonce).
- API errors now surface the backend's actual message. The client read only
  `response.data.message`, but the backend returns `error` (and sometimes `code`),
  so every failure showed as a generic "Request failed with status code 400".
- MCP outcome/HIP-3 tools (`hl_create_outcome_order`, `hl_cancel_outcome_order`,
  `hl_close_outcome_order`, `hl_enable_trading`, `hl_swap_collateral`) now accept
  structured params and build the payload via the SDK — previously they required a
  pre-built `computedData` no agent could produce. `hl_outcome_account` now takes
  `outcomeId`. SKILL docs for `gdex-hl-outcomes` and `gdex-perp-funding` updated.
- `getHlOutcomeAccount` now sends the required `outcomeId` (the backend rejects the
  previous `dex`-only query with 400).
- HyperLiquid market orders now work with the documented `price: '0'`. `hlCreateOrder`
  resolves the current mark price for market orders before sending, because the backend
  multiplies the supplied price by a slippage factor and enforces a min-notional check
  (`price * size >= $11`) — so `price: '0'` previously failed with "Min order size value
  is 11$" even for adequately-sized positions.
- Spot trades now apply slippage correctly. `buyToken`, `sellToken`,
  `submitManagedPurchase`, and `submitManagedSell` send the `slippage` percent to the
  `purchase_v2` / `sell_v2` endpoints as basis points (×100). The backend trade worker
  reads the wire value as the numerator of `[slippage, 10000]`, so the documented
  `slippage: 5` (5%) was previously sent as 5 → 0.05%, ~100x too tight, causing Raydium
  to revert managed sells with "exceeds desired slippage limit" (custom error 0x1e).
- `buildChainAliases` now sends a numeric `chainId` for the `'solana'` and `'sui'`
  string aliases. Previously only numeric chain inputs got a `chainId`, so documented
  calls like `getTrendingTokens({ chain: 'solana' })` (and other discovery endpoints)
  silently returned empty results because the backend filters on numeric `chainId`.
- `scripts/e2e-full.js` wraps the section 4 and section 6 managed-custody sign-ins in
  try/catch. A transient sign-in failure previously threw uncaught and aborted the
  whole suite before later sections ran.
- Resolved fixable dependency advisories via `npm audit fix` (root 13 → 6, mcp-server
  7 → 0). Remaining root advisories require breaking upgrades and were left untouched.

### Removed

## [3.3.1] - 2026-05-22

### Added

- `buildWatchListComputedData` and `buildImportTokenComputedData` helpers in `src/utils/gdexManagedCrypto.ts`, exported from `src/index.ts`.
- Round-trip and wire-shape tests in `tests/utils/gdexManagedCrypto.test.ts` and `tests/actions/social.test.ts`.

### Changed

- `changeWatchList` and `importToken` in `src/actions/social.ts` now accept either a structured payload or a pre-encoded `{ computedData, chainId? }` shape and always send `{ computedData, chainId? }` over the wire.
- Top-of-file comment in `src/actions/social.ts` updated so only `addComment` and `voteSentiment` are listed as plain-JSON endpoints.
- `change_watchlist` and `import_token` MCP tool schemas in `mcp-server/src/tools/v110.ts` reduced to `{ computedData, chainId? }`.
- SKILL examples in `skills/gdex-watchlist-social/SKILL.md` and `skills/gdex-token-import/SKILL.md` updated to the encrypted shape.

### Fixed

- Lands PR #10 changes that were referenced by the 3.3.0 CHANGELOG but never merged onto main.

## [3.3.0] - 2026-05-22

Backend contract verified against
[`TheArcadiaGroup/gbotTradingDashboardBackend@7b25715`](https://github.com/TheArcadiaGroup/gbotTradingDashboardBackend/commit/7b25715).

This release wraps up the v1.1.0 backend-contract sweep landed across PRs
#7, #8, #9, and #10. It is a minor (not patch) bump because PR #10
changed the wire format of `change_watchlist` and `import_token` from
plain JSON to encrypted `computedData` — any caller pinned to 3.2.x that
was passing the old shape will break. See **Migration from 3.2.x** below.

### Added
- `buildAssociateEmailComputedData`, `buildTransferComputedData`,
  `buildWatchListComputedData`, `buildImportTokenComputedData`
  managed-custody helpers in `src/utils/gdexManagedCrypto.ts`. (#8, #9, #10)
- Structured-or-raw call shape for `transferNative`, `transferToken`,
  `changeWatchList`, `importToken` — pass `{ recipient, amount, managed }`
  etc. and the SDK builds `computedData` for you. (#9, #10)
- Tests: `tests/actions/auth.test.ts`, `tests/actions/transfers.test.ts`,
  `tests/actions/social.test.ts`, expanded `tests/utils/gdexManagedCrypto.test.ts`.

### Changed
- `oauthLogin` body is now `{ idToken, chainId? }`. Google ID tokens
  only; `provider` / `accessToken` fields removed. (#8)
- `associateEmail` body is now `{ computedData, idToken }`. The email
  is extracted server-side from the verified Google ID token — the
  client never sends a raw email. (#8)
- MCP `oauth_login` and `associate_email` tool schemas + descriptions
  rewritten to reflect the Google-only, associate-email-first flow. (#8)
- `change_watchlist` and `import_token` now post
  `{ computedData, chainId? }` instead of plain JSON. (#10)
- Endpoint constants in `src/client/endpoints.ts` reconciled with
  backend routes: `/v1/portfolio` (balances embedded),
  `/v1/user_history`, `tradeStatusPath(requestId)`, parameterized
  `tradingView*` helpers. (#9)
- MCP server bumped 3.1.0 → 3.2.0 (PR #9), now 3.3.0.
- README tool count corrected from 76 to 116. (#9)
- SKILL.md docs updated across `gdex-authentication`,
  `gdex-watchlist-social`, `gdex-token-import`,
  `gdex-portfolio`, `gdex-sdk-debugging`,
  `gdex-ui-portfolio-dashboard`. (#7, #8, #9, #10)

### Fixed
- `change_watchlist` and `import_token` were silently falling back to
  header-based identity on the backend because the SDK was sending
  plain JSON; both endpoints actually require `serverDecryptData` /
  `computedData`. (#10)

### Removed
- Phantom endpoint constants that don't exist on the backend
  (`/v1/auth/nonce`, `/v1/auth/login`, `/v1/auth/refresh`,
  `/v1/auth/logout`, `/v1/user/update`, `/v1/wallet/info`,
  `/v1/balances`, `/v1/token/search`, fixed `/v1/trading_view/*` paths,
  duplicate `/v1/trending/list`, old `/v1/user_trade_history`). (#9)
- `provider`, `accessToken`, `email`, `refSourceCode` from
  `OAuthLoginParams`; `userId`, `email`, `data`, `verificationToken`
  from `AssociateEmailParams`. (#8)

### Migration from 3.2.x

Minimum diff a caller needs to upgrade:

- `oauth_login`:        `{ provider, token, email? }`   → `{ idToken, chainId? }`
- `associate_email`:    `{ userId, email, data? }`      → `{ computedData, idToken }`
- `change_watchlist`:   `{ userId, tokenAddress, … }`   → `{ computedData, chainId? }`
                        (or structured `{ tokenAddress, chainId, action, managed }`)
- `import_token`:       `{ userId, tokenAddress, … }`   → `{ computedData, chainId? }`
                        (or structured `{ tokenAddress, chainId, managed }`)
- `transfer_native` /
  `transfer_token`:     unchanged on the wire; structured shape now
                        available via `managed: {...}`.

[Unreleased]: https://github.com/GemachDAO/gdex-skill/compare/v4.3.0...HEAD
[4.3.0]: https://github.com/GemachDAO/gdex-skill/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/GemachDAO/gdex-skill/compare/v4.1.1...v4.2.0
[4.1.1]: https://github.com/GemachDAO/gdex-skill/compare/v4.1.0...v4.1.1
[4.1.0]: https://github.com/GemachDAO/gdex-skill/compare/v4.0.0...v4.1.0
[3.3.0]: https://github.com/GemachDAO/gdex-skill/releases/tag/v3.3.0
