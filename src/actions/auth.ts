/**
 * Extended authentication actions — OAuth login and email association.
 *
 * The shared API-key flow (`loginWithApiKey`) and the wallet sign-in flow
 * (`authenticate`, `signInWithComputedData`) remain the primary entry points;
 * these helpers support newer OAuth-based onboarding paths.
 *
 * Backed by:
 *   POST /v1/auth/oauth-login
 *   POST /v1/auth/associate-email
 */
import { GdexApiClient } from '../client';
import * as Endpoints from '../client/endpoints';
import { validateRequired } from '../utils/validation';

export interface OAuthLoginParams {
  /** OAuth provider, e.g. 'google' | 'apple' | 'twitter' */
  provider: string;
  /** Provider-issued ID token / access token */
  token: string;
  /** Optional email / profile hints */
  email?: string;
  /** Optional referral source code */
  refSourceCode?: string;
}

export interface OAuthLoginResponse extends Record<string, unknown> {
  token?: string;
  userId?: string;
  isNewUser?: boolean;
}

export interface AssociateEmailParams {
  /** User identifier (control wallet) */
  userId: string;
  /** Email to associate */
  email: string;
  /** Encrypted session data for authentication */
  data?: string;
  /** Optional verification token, when the backend uses a two-step flow */
  verificationToken?: string;
}

/** Log in (or sign up) via OAuth. Returns a session token. */
export async function oauthLogin(
  client: GdexApiClient,
  params: OAuthLoginParams,
): Promise<OAuthLoginResponse> {
  validateRequired(params.provider, 'provider');
  validateRequired(params.token, 'token');
  return client.post<OAuthLoginResponse>(Endpoints.AUTH_OAUTH_LOGIN, params);
}

/** Associate an email address with an existing wallet-based account. */
export async function associateEmail(
  client: GdexApiClient,
  params: AssociateEmailParams,
): Promise<Record<string, unknown>> {
  validateRequired(params.userId, 'userId');
  validateRequired(params.email, 'email');
  return client.post(Endpoints.AUTH_ASSOCIATE_EMAIL, params);
}
