/**
 * Tests for OAuth login and email association actions.
 *
 * Verifies the exact request body shape sent to the backend
 * (gbotTradingDashboardBackend v1.1.0):
 *   POST /v1/auth/oauth-login     { idToken, chainId? }
 *   POST /v1/auth/associate-email { computedData, idToken }
 */
import { GdexApiClient } from '../../src/client';
import { oauthLogin, associateEmail } from '../../src/actions/auth';
import { GdexValidationError } from '../../src/utils/errors';

jest.mock('../../src/client');
const MockedClient = GdexApiClient as jest.MockedClass<typeof GdexApiClient>;

describe('auth (oauth-login / associate-email)', () => {
  let client: jest.Mocked<GdexApiClient>;

  beforeEach(() => {
    client = new MockedClient() as jest.Mocked<GdexApiClient>;
  });

  // ── oauthLogin ────────────────────────────────────────────────────────────

  describe('oauthLogin', () => {
    it('posts exactly { idToken } to /v1/auth/oauth-login', async () => {
      client.post = jest.fn().mockResolvedValue({ token: 'sess', userId: '0xabc' });

      const result = await oauthLogin(client, { idToken: 'google-jwt-xyz' });

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/v1/auth/oauth-login', {
        idToken: 'google-jwt-xyz',
      });
      expect(result).toEqual({ token: 'sess', userId: '0xabc' });
    });

    it('includes chainId when provided', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await oauthLogin(client, { idToken: 'jwt', chainId: 1 });

      expect(client.post).toHaveBeenCalledWith('/v1/auth/oauth-login', {
        idToken: 'jwt',
        chainId: 1,
      });
    });

    it('accepts chainId as a string', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await oauthLogin(client, { idToken: 'jwt', chainId: '622112261' });

      expect(client.post).toHaveBeenCalledWith('/v1/auth/oauth-login', {
        idToken: 'jwt',
        chainId: '622112261',
      });
    });

    it('does not leak provider / accessToken / email / refSourceCode fields', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await oauthLogin(client, { idToken: 'jwt' });

      const body = (client.post as jest.Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('provider');
      expect(body).not.toHaveProperty('token');
      expect(body).not.toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('refSourceCode');
    });

    it('throws GdexValidationError when idToken is missing', async () => {
      client.post = jest.fn();

      await expect(
        // @ts-expect-error — intentionally invalid for runtime validation
        oauthLogin(client, {}),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });

  // ── associateEmail ────────────────────────────────────────────────────────

  describe('associateEmail', () => {
    it('posts exactly { computedData, idToken } to /v1/auth/associate-email', async () => {
      client.post = jest.fn().mockResolvedValue({ ok: true });

      const result = await associateEmail(client, {
        computedData: 'deadbeefcafe',
        idToken: 'google-jwt-xyz',
      });

      expect(client.post).toHaveBeenCalledTimes(1);
      expect(client.post).toHaveBeenCalledWith('/v1/auth/associate-email', {
        computedData: 'deadbeefcafe',
        idToken: 'google-jwt-xyz',
      });
      expect(result).toEqual({ ok: true });
    });

    it('does not leak an `email` field into the request body', async () => {
      client.post = jest.fn().mockResolvedValue({});

      await associateEmail(client, {
        computedData: 'deadbeefcafe',
        idToken: 'google-jwt-xyz',
      });

      const body = (client.post as jest.Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(body).not.toHaveProperty('email');
      expect(body).not.toHaveProperty('userId');
      expect(body).not.toHaveProperty('verificationToken');
      expect(body).not.toHaveProperty('data');
      expect(body).not.toHaveProperty('signature');
      expect(Object.keys(body).sort()).toEqual(['computedData', 'idToken']);
    });

    it('throws GdexValidationError when computedData is missing', async () => {
      client.post = jest.fn();

      await expect(
        // @ts-expect-error — intentionally invalid for runtime validation
        associateEmail(client, { idToken: 'jwt' }),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });

    it('throws GdexValidationError when idToken is missing', async () => {
      client.post = jest.fn();

      await expect(
        // @ts-expect-error — intentionally invalid for runtime validation
        associateEmail(client, { computedData: 'deadbeef' }),
      ).rejects.toBeInstanceOf(GdexValidationError);
      expect(client.post).not.toHaveBeenCalled();
    });
  });
});
