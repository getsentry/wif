import type { webApi } from '@slack/bolt';

export interface SlackToolsContext {
  slackClient: Pick<webApi.WebClient, 'chat'>;
  channel: string;
  threadTs: string | undefined;
}

export function createSlackTools(ctx: SlackToolsContext) {
  const { slackClient, channel, threadTs } = ctx;

  return {
    async updateSlackMessage(ts: string | undefined, text: string): Promise<void> {
      if (!ts) return;
      await slackClient.chat.update({
        channel,
        ts,
        markdown_text: text,
      });
    },
    async postNewSlackMessage(text: string): Promise<string | undefined> {
      const response = await slackClient.chat.postMessage({
        channel,
        thread_ts: threadTs,
        markdown_text: text,
      });
      return response.ts;
    },
  };
}
