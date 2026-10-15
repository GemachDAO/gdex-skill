import { describe, it, expect, afterEach } from '@jest/globals';
import { readEnv } from '../src/sdk.js';

const KEY = 'GDEX_TEST_READ_ENV';

describe('readEnv', () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it('returns a set value', () => {
    process.env[KEY] = 'abc-123';
    expect(readEnv(KEY)).toBe('abc-123');
  });

  it('treats unset and empty values as unset', () => {
    expect(readEnv(KEY)).toBeUndefined();
    process.env[KEY] = '   ';
    expect(readEnv(KEY)).toBeUndefined();
  });

  it('treats an unexpanded ${...} placeholder as unset (Codex passes ${user_config.*} through literally)', () => {
    process.env[KEY] = '${user_config.gdex_api_key}';
    expect(readEnv(KEY)).toBeUndefined();
  });
});
