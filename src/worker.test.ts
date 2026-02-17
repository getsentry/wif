import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processSlackWebhook } from './worker.js';
import * as analyzeModule from './analysis/analyze.js';

describe('processSlackWebhook', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(analyzeModule, 'analyzeIssue').mockResolvedValue({
      owner: 'getsentry',
      repo: 'sentry',
      confidence: 'high',
      reasoning: 'Test reasoning',
    });
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

  it('posts analysis result to Slack thread on app_mention', async () => {
    const mockSlackClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
      reactions: {
        add: vi.fn().mockResolvedValue({ ok: true }),
        remove: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    const mockGithubClient = {
      listOrgPublicRepos: vi.fn().mockResolvedValue([]),
    };

    const data = {
      event: {
        type: 'app_mention',
        channel: 'C123',
        ts: '1234567890.123456',
        thread_ts: '1234567890.123400',
        text: 'analyze this issue',
      },
    };

    await processSlackWebhook(data as never, {
      slackClient: mockSlackClient as never,
      githubClient: mockGithubClient,
    });

    expect(mockSlackClient.reactions.add).toHaveBeenNthCalledWith(1, {
      channel: 'C123',
      timestamp: '1234567890.123456',
      name: 'eyes',
    });
    expect(mockSlackClient.reactions.remove).toHaveBeenCalledWith({
      channel: 'C123',
      timestamp: '1234567890.123456',
      name: 'eyes',
    });
    expect(mockSlackClient.reactions.add).toHaveBeenNthCalledWith(2, {
      channel: 'C123',
      timestamp: '1234567890.123456',
      name: 'white_check_mark',
    });
    expect(analyzeModule.analyzeIssue).toHaveBeenCalledWith('analyze this issue');
    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123',
        thread_ts: '1234567890.123400',
        text: expect.stringContaining('*Repository Analysis*'),
      })
    );
  });

  it('replaces eyes with x and posts error on failure', async () => {
    vi.spyOn(analyzeModule, 'analyzeIssue').mockRejectedValue(new Error('Analysis failed'));

    const mockSlackClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
      reactions: {
        add: vi.fn().mockResolvedValue({ ok: true }),
        remove: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    const mockGithubClient = {
      listOrgPublicRepos: vi.fn().mockResolvedValue([]),
    };

    const data = {
      event: {
        type: 'app_mention',
        channel: 'C123',
        ts: '1234567890.123456',
        thread_ts: '1234567890.123400',
        text: 'analyze this issue',
      },
    };

    await expect(
      processSlackWebhook(data as never, {
        slackClient: mockSlackClient as never,
        githubClient: mockGithubClient,
      })
    ).rejects.toThrow('Analysis failed');

    expect(mockSlackClient.reactions.add).toHaveBeenNthCalledWith(1, {
      channel: 'C123',
      timestamp: '1234567890.123456',
      name: 'eyes',
    });
    expect(mockSlackClient.reactions.remove).toHaveBeenCalledWith({
      channel: 'C123',
      timestamp: '1234567890.123456',
      name: 'eyes',
    });
    expect(mockSlackClient.reactions.add).toHaveBeenNthCalledWith(2, {
      channel: 'C123',
      timestamp: '1234567890.123456',
      name: 'x',
    });
    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      thread_ts: '1234567890.123400',
      markdown_text: 'Something went wrong: Analysis failed',
    });
  });

  it('includes SDK version in response when present', async () => {
    vi.spyOn(analyzeModule, 'analyzeIssue').mockResolvedValue({
      owner: 'getsentry',
      repo: 'sentry-javascript',
      confidence: 'high',
      reasoning: 'Issue mentions JavaScript SDK',
      sdkVersion: '8.1.0',
    });

    const mockSlackClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
      reactions: {
        add: vi.fn().mockResolvedValue({ ok: true }),
        remove: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    const mockGithubClient = {
      listOrgPublicRepos: vi.fn().mockResolvedValue([]),
    };

    const data = {
      event: {
        type: 'app_mention',
        channel: 'C123',
        ts: '1234567890.123456',
        text: 'Issue with @sentry/node@8.1.0',
      },
    };

    await processSlackWebhook(data as never, {
      slackClient: mockSlackClient as never,
      githubClient: mockGithubClient,
    });

    expect(mockSlackClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123',
        text: expect.stringContaining('*SDK Version:* 8.1.0'),
      })
    );
  });
});
