import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/node';
import { fetchThreadMessages } from './thread.js';

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

const FALLBACK = 'fallback event text';

describe('fetchThreadMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and formats thread messages with anonymous labels', async () => {
    const mockSlackClient = {
      conversations: {
        replies: vi.fn().mockResolvedValue({
          ok: true,
          messages: [
            { user: 'U1', text: 'Hey was X fixed yet?', ts: '1234567890.123400' },
            { user: 'U2', text: "Let's see if @wif knows that", ts: '1234567890.123456' },
          ],
        }),
      },
    };

    const result = await fetchThreadMessages(
      mockSlackClient as never,
      'C123',
      '1234567890.123400',
      FALLBACK
    );

    expect(mockSlackClient.conversations.replies).toHaveBeenCalledWith({
      channel: 'C123',
      ts: '1234567890.123400',
      limit: 200,
    });
    expect(result).toBe("User 1: Hey was X fixed yet?\n\nUser 2: Let's see if @wif knows that");
  });

  it('handles pagination when thread has many messages', async () => {
    const mockSlackClient = {
      conversations: {
        replies: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            messages: [{ user: 'U1', text: 'First', ts: '1' }],
            response_metadata: { next_cursor: 'cursor1' },
          })
          .mockResolvedValueOnce({
            ok: true,
            messages: [{ user: 'U1', text: 'Second', ts: '2' }],
          }),
      },
    };

    const result = await fetchThreadMessages(mockSlackClient as never, 'C123', '1', FALLBACK);

    expect(mockSlackClient.conversations.replies).toHaveBeenCalledTimes(2);
    expect(mockSlackClient.conversations.replies).toHaveBeenNthCalledWith(2, {
      channel: 'C123',
      ts: '1',
      limit: 200,
      cursor: 'cursor1',
    });
    expect(result).toBe('User 1: First\n\nUser 1: Second');
  });

  it('returns fallback text and reports to Sentry when replies fails', async () => {
    const apiError = new Error('missing_scope');
    const mockSlackClient = {
      conversations: {
        replies: vi.fn().mockRejectedValue(apiError),
      },
    };

    const result = await fetchThreadMessages(mockSlackClient as never, 'C123', '1', FALLBACK);

    expect(result).toBe(FALLBACK);
    expect(Sentry.captureException).toHaveBeenCalledWith(apiError);
  });
});
