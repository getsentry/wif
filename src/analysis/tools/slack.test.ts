import { describe, it, expect, vi } from 'vitest';
import { createSlackTools } from './slack.js';

describe('createSlackTools', () => {
  it('updateSlackMessage calls chat.update with the given ts', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true });
    const tools = createSlackTools({
      slackClient: { chat: { update, postMessage: vi.fn() } },
      channel: 'C123',
      threadTs: '123.456',
    });

    await tools.updateSlackMessage('123.999', 'Classifying…');

    expect(update).toHaveBeenCalledWith({
      channel: 'C123',
      ts: '123.999',
      markdown_text: 'Classifying…',
    });
  });

  it('updateSlackMessage is no-op when ts is undefined', async () => {
    const update = vi.fn();
    const tools = createSlackTools({
      slackClient: { chat: { update, postMessage: vi.fn() } },
      channel: 'C123',
      threadTs: undefined,
    });

    await tools.updateSlackMessage(undefined, 'Classifying…');

    expect(update).not.toHaveBeenCalled();
  });

  it('postNewSlackMessage calls chat.postMessage and returns ts', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: '123.999' });
    const tools = createSlackTools({
      slackClient: { chat: { update: vi.fn(), postMessage } },
      channel: 'C123',
      threadTs: '123.456',
    });

    const ts = await tools.postNewSlackMessage('*Result*');

    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      thread_ts: '123.456',
      markdown_text: '*Result*',
    });
    expect(ts).toBe('123.999');
  });

  it('postNewSlackMessage accepts blocks and sends blocks + text', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: '456.000' });
    const tools = createSlackTools({
      slackClient: { chat: { update: vi.fn(), postMessage } },
      channel: 'C123',
      threadTs: undefined,
    });

    const blocks = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text: '*Hello*' } },
    ];
    const ts = await tools.postNewSlackMessage({ blocks, text: 'Hello' });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123',
        thread_ts: undefined,
        blocks,
        text: 'Hello',
      })
    );
    expect(ts).toBe('456.000');
  });

  it('updateSlackMessage accepts blocks', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true });
    const tools = createSlackTools({
      slackClient: { chat: { update, postMessage: vi.fn() } },
      channel: 'C123',
      threadTs: undefined,
    });

    const blocks = [
      { type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'Updated' } },
    ];
    await tools.updateSlackMessage('123.999', { blocks, text: 'Updated' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123',
        ts: '123.999',
        blocks,
        text: 'Updated',
      })
    );
  });
});
