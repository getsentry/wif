import type { webApi } from '@slack/bolt';
import { withToolSpan } from './span.js';

export interface SlackToolsContext {
  slackClient: Pick<webApi.WebClient, 'chat' | 'files'>;
  channel: string;
  threadTs: string | undefined;
}

export function createSlackTools(ctx: SlackToolsContext) {
  const { slackClient, channel, threadTs } = ctx;

  return {
    async updateSlackMessage(ts: string | undefined, text: string): Promise<void> {
      return withToolSpan('updateSlackMessage', { ts, channel }, async () => {
        if (!ts) return;
        await slackClient.chat.update({
          channel,
          ts,
          markdown_text: text,
        });
      });
    },
    async postNewSlackMessage(text: string): Promise<string | undefined> {
      return withToolSpan('postNewSlackMessage', { channel, threadTs }, async () => {
        const response = await slackClient.chat.postMessage({
          channel,
          thread_ts: threadTs,
          markdown_text: text,
        });
        return response.ts;
      });
    },
    async uploadFileToThread(filename: string, content: string): Promise<void> {
      return withToolSpan('uploadFileToThread', { channel, filename }, async () => {
        await slackClient.files.upload({
          channels: channel,
          content,
          filename,
          initial_comment: 'Reasoning document',
          ...(threadTs ? { thread_ts: threadTs } : {}),
        } as Parameters<typeof slackClient.files.upload>[0]);
      });
    },
  };
}
