import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processSlackWebhook } from './worker.js';

describe('processSlackWebhook', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('resolves without error for non-app_mention events', async () => {
    const data = { event: { type: 'message' } };
    await expect(processSlackWebhook(data as never)).resolves.toBeUndefined();
  });

  it('processes payload data', async () => {
    const data = { event: { type: 'message', text: 'hello' } };
    await processSlackWebhook(data as never);

    expect(console.log).toHaveBeenCalledWith('Worker is processing job with data:', data);
    expect(console.log).toHaveBeenCalledWith('Worker is done processing job');
  });

  it('completes for events with event payload', async () => {
    const data = { event: { type: 'reaction_added' } };
    await expect(processSlackWebhook(data as never)).resolves.toBeUndefined();
  });

  it('posts repo list to Slack thread on app_mention', async () => {
    const mockRepos = [
      { fullName: 'getsentry/sentry', htmlUrl: 'https://github.com/getsentry/sentry' },
      { fullName: 'getsentry/wif', htmlUrl: 'https://github.com/getsentry/wif' },
    ];
    const mockSlackClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    const mockGithubClient = {
      listOrgPublicRepos: vi.fn().mockResolvedValue(mockRepos),
    };

    const data = {
      event: {
        type: 'app_mention',
        channel: 'C123',
        ts: '1234567890.123456',
        thread_ts: '1234567890.123400',
      },
    };

    await processSlackWebhook(data as never, {
      slackClient: mockSlackClient as never,
      githubClient: mockGithubClient,
    });

    expect(mockGithubClient.listOrgPublicRepos).toHaveBeenCalledWith('getsentry');
    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      thread_ts: '1234567890.123400',
      markdown_text:
        '**Public repositories in getsentry** (2):\n\n' +
        '- [getsentry/sentry](https://github.com/getsentry/sentry)\n' +
        '- [getsentry/wif](https://github.com/getsentry/wif)',
    });
  });
});
