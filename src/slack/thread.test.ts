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

  it('fetches and formats thread messages with user names', async () => {
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
      users: {
        info: vi
          .fn()
          .mockResolvedValueOnce({ ok: true, user: { real_name: 'Phil' } })
          .mockResolvedValueOnce({ ok: true, user: { real_name: 'Lukas' } }),
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
    expect(result).toBe("Phil: Hey was X fixed yet?\n\nLukas: Let's see if @wif knows that");
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
      users: {
        info: vi.fn().mockResolvedValue({ ok: true, user: { real_name: 'User' } }),
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
    expect(result).toBe('User: First\n\nUser: Second');
  });

  it('falls back to user id when users.info fails', async () => {
    const mockSlackClient = {
      conversations: {
        replies: vi.fn().mockResolvedValue({
          ok: true,
          messages: [{ user: 'U1', text: 'Hello', ts: '1' }],
        }),
      },
      users: {
        info: vi.fn().mockRejectedValue(new Error('User not found')),
      },
    };

    const result = await fetchThreadMessages(mockSlackClient as never, 'C123', '1', FALLBACK);

    expect(result).toBe('U1: Hello');
  });

  it('returns fallback text and reports to Sentry when replies fails', async () => {
    const apiError = new Error('missing_scope');
    const mockSlackClient = {
      conversations: {
        replies: vi.fn().mockRejectedValue(apiError),
      },
      users: { info: vi.fn() },
    };

    const result = await fetchThreadMessages(mockSlackClient as never, 'C123', '1', FALLBACK);

    expect(result).toBe(FALLBACK);
    expect(Sentry.captureException).toHaveBeenCalledWith(apiError);
  });
});
