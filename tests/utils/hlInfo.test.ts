import axios from 'axios';
import { HL_INFO_URL, hlInfoRequest } from '../../src/utils/hlInfo';
import { GdexNetworkError } from '../../src/utils/errors';

jest.mock('axios');
const post = axios.post as jest.Mock;

describe('hlInfoRequest', () => {
  it('POSTs the body to the HyperLiquid info API and returns the JSON', async () => {
    post.mockResolvedValue({ data: [{ universe: [] }, []] });
    const res = await hlInfoRequest({ type: 'metaAndAssetCtxs', dex: 'xyz' });
    expect(res).toEqual([{ universe: [] }, []]);
    expect(HL_INFO_URL).toBe('https://api.hyperliquid.xyz/info');
    expect(post).toHaveBeenCalledWith(
      HL_INFO_URL,
      { type: 'metaAndAssetCtxs', dex: 'xyz' },
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it('raises a typed network error instead of returning an empty answer', async () => {
    post.mockRejectedValue(Object.assign(new Error('Request failed with status code 429'), { response: { status: 429 } }));
    const err = await hlInfoRequest({ type: 'allMids' }).catch((e: Error) => e) as Error;
    expect(err).toBeInstanceOf(GdexNetworkError);
    expect(err.message).toMatch(/"allMids" failed \(HTTP 429\)/);
  });
});
