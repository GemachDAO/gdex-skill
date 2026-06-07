# Security

## Reporting

Report vulnerabilities via a GitHub security advisory on this repo.

## Notes on automated scanners (Socket / Snyk)

The skills.sh listing surfaces automated scanner results. For transparency:

- **Shared API keys in `src/config/apiKeys.ts` are public by design.** GDEX exposes
  rotating *shared* keys so agents can call read endpoints and managed-custody trading
  without a per-user signup. They are not secrets and grant no access beyond the public
  GDEX trading API. For production, supply your own key via `GDEX_API_KEY`.

- **Install builds from source (`prepare` script).** Because the package is installed
  from GitHub (`npm install github:GemachDAO/gdex-skill`) rather than a prebuilt npm
  release, install runs a TypeScript build. Scanners flag install/lifecycle scripts;
  this one only runs `tsc`. (A published npm release would ship prebuilt and drop this.)

- **Transitive dependency advisories.** A few advisories come from `gdex.pro-sdk` and
  `ethers` (e.g. `elliptic`, `secp256k1`, `ws`) and currently have **no upstream fix**.
  They are monitored and will be picked up when the upstream packages publish patches.

- **Wallet / private-key handling.** The SDK signs locally with session keys; private
  keys are never transmitted. See `gdex-authentication`.
