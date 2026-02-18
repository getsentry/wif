import { describe, it, expect, vi } from 'vitest';
import { createSlackTools } from './slack.js';

describe('createSlackTools', () => {
  it('updateSlackMessage calls chat.update with the given ts', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true });
    const tools = createSlackTools({
      slackClient: { chat: { update, postMessage: vi.fn() }, files: { upload: vi.fn() } },
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
      slackClient: { chat: { update, postMessage: vi.fn() }, files: { upload: vi.fn() } },
      channel: 'C123',
      threadTs: undefined,
    });

    await tools.updateSlackMessage(undefined, 'Classifying…');

    expect(update).not.toHaveBeenCalled();
  });

  it('postNewSlackMessage calls chat.postMessage and returns ts', async () => {
    const postMessage = vi.fn().mockResolvedValue({ ok: true, ts: '123.999' });
    const tools = createSlackTools({
      slackClient: { chat: { update: vi.fn(), postMessage }, files: { upload: vi.fn() } },
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

  it('uploadFileToThread calls files.upload with content and thread_ts', async () => {
    const upload = vi.fn().mockResolvedValue({ ok: true });
    const tools = createSlackTools({
      slackClient: { chat: { update: vi.fn(), postMessage: vi.fn() }, files: { upload } },
      channel: 'C123',
      threadTs: '123.456',
    });

    await tools.uploadFileToThread('reasoning.md', '# Doc\n\nContent');

    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: 'C123',
        content: '# Doc\n\nContent',
        filename: 'reasoning.md',
        initial_comment: 'Reasoning document',
        thread_ts: '123.456',
      })
    );
  });
});
