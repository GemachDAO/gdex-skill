/**
 * Extended authentication actions — Google OAuth login and email association.
 *
 * The shared API-key flow (`loginWithApiKey`) and the wallet sign-in flow
 * (`authenticate`, `signInWithComputedData`) remain the primary entry points;
 * these helpers support Google-OAuth-based onboarding.
 *
 * Backed by (verified against gbotTradingDashboardBackend v1.1.0,
 * `ServiceMain.oauthLogin` / `ServiceMain.associateEmail`):
 *   POST /v1/auth/oauth-login        — Google ID tokens only.
 *   POST /v1/auth/associate-email    — Email is derived server-side from the
 *                                      verified Google ID token; caller must
 *                                      call this first if `oauthLogin` returns
 *                                      404 with internal code 108 (no
 *                                      `associatedEmail` for the wallet).
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';

export interface OAuthLoginParams {
  /** Google-issued OIDC ID token (JWT). Google IDPs only — no Apple/GitHub branch. */
  idToken: string;
  /** Optional chain id hint for wallet resolution. */
  chainId?: string | number;
}

export interface OAuthLoginResponse extends Record<string, unknown> {
  token?: string;
  userId?: string;
  isNewUser?: boolean;
}

export interface AssociateEmailParams {
  /**
   * Managed-custody encrypted payload built with
   * `buildAssociateEmailComputedData` (ABI `['associate_email', [nonce]]`,
   * sig msg `associate_email-${userId}-${data}`).
   */
  computedData: string;
  /** Google-issued OIDC ID token (JWT). Email is extracted server-side from this token. */
  idToken: string;
}

/**
 * Log in (or sign up) via Google OAuth. Returns a session token.
 *
 * Backend handler: `ServiceMain.oauthLogin` (route `POST /v1/auth/oauth-login`).
 *
 * Google ID tokens only — there is no `provider` / Apple / GitHub branch on
 * the backend. If the wallet has no `associatedEmail` yet, the backend
 * responds with HTTP 404 and internal code 108; callers must invoke
 * `associateEmail` first using the same `idToken`.
 */
export async function oauthLogin(
  client: GdexApiClient,
  params: OAuthLoginParams,
): Promise<OAuthLoginResponse> {
  validateRequired(params.idToken, 'idToken');
  const body: Record<string, unknown> = { idToken: params.idToken };
  if (params.chainId !== undefined) {
    body.chainId = params.chainId;
  }
  return client.post<OAuthLoginResponse>(Endpoints.AUTH_OAUTH_LOGIN, body);
}

/**
 * Associate the email claim from a Google ID token with the caller's wallet.
 *
 * Backend handler: `ServiceMain.associateEmail` (route
 * `POST /v1/auth/associate-email`). The email itself is **not** sent by the
 * client — the backend verifies the Google `idToken` and extracts the email
 * claim from it. The `computedData` payload must be built with
 * `buildAssociateEmailComputedData` so that the backend can authenticate the
 * managed-custody session that owns the wallet.
 */
export async function associateEmail(
  client: GdexApiClient,
  params: AssociateEmailParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.computedData, 'computedData');
  validateRequired(params.idToken, 'idToken');
  return client.post(Endpoints.AUTH_ASSOCIATE_EMAIL, {
    computedData: params.computedData,
    idToken: params.idToken,
  });
}
