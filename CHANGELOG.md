# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

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

[Unreleased]: https://github.com/GemachDAO/gdex-skill/compare/v3.3.0...HEAD
[3.3.0]: https://github.com/GemachDAO/gdex-skill/releases/tag/v3.3.0
