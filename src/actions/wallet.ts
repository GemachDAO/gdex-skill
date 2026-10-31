/**
 * Wallet action — managed-wallet summary (native balance and holdings) on one chain.
 *
 * Backend contract (gbotTradingDashboardBackend): there is no `/v1/wallet/info`
 * route and no public, address-only balance read. Both sources need the
 * managed session (`userId` + encrypted `data` + `chainId`):
 *
 * - `GET /v1/user` (ServiceMain.ts:1151-1226): managed wallet address and its
 *   native balance as a float in whole units.
 * - `GET /v1/portfolio` (ServiceMain.ts:2723-2775): `{ holding: [] }` token rows.
 *
 * So this is the same authenticated managed read as `getTradingFunds` and
 * `getPortfolio` (src/actions/portfolio.ts), combined.
 */
import { GdexApiClient } from '../client';
import { WalletInfo, WalletInfoParams } from '../types';
import { GdexValidationError } from '../utils/errors';
import { getPortfolio, getTradingFunds, managedChain, managedReadAuth } from './portfolio';

/**
 * Native balance, token count and total value of the managed wallet on one chain.
 *
 * @param client - API client
 * @param params - Control wallet, session (`data`, or `sessionPrivateKey` + `apiKey`) and chain
 * @throws {GdexValidationError} without a session or on an unsupported chain (nothing is sent)
 * @throws {GdexApiError} when the backend refuses or returns a malformed envelope
 */
export async function getWalletInfo(
  client: GdexApiClient,
  params: WalletInfoParams
): Promise<WalletInfo> {
  if (params.chain === undefined) throw new GdexValidationError('chain is required', 'chain');
  const chain = managedChain(params.chain);
  // Resolve the session once so both reads send the same `data`.
  const auth = managedReadAuth(params);
  const read = { walletAddress: auth.userId, data: auth.data, chain: chain.id };

  const [funds, portfolio] = await Promise.all([getTradingFunds(client, read), getPortfolio(client, read)]);

  const info: WalletInfo = {
    address: funds.address,
    userId: auth.userId,
    chain: chain.id,
    chainId: chain.id,
    nativeBalance: funds.nativeBalance,
    nativeSymbol: funds.nativeSymbol,
    precision: 'approximate',
    tokenCount: portfolio.holdings.length,
  };
  if (portfolio.totalValueUsd !== undefined) info.totalValueUsd = portfolio.totalValueUsd;
  return info;
}
