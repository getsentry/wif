import type { webApi } from '@slack/bolt';
import { withToolSpan } from './span.js';

export interface SlackToolsContext {
  slackClient: Pick<webApi.WebClient, 'chat'>;
  channel: string;
  threadTs: string | undefined;
}

/** Block Kit block types we use (section, context, divider). */
export type SlackBlock =
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> }
  | { type: 'divider' };

/** Message content: either plain markdown text or Block Kit blocks with optional fallback text. */
export type SlackMessageContent = string | { blocks: SlackBlock[]; text?: string };

export function createSlackTools(ctx: SlackToolsContext) {
  const { slackClient, channel, threadTs } = ctx;

  return {
    async updateSlackMessage(ts: string | undefined, content: SlackMessageContent): Promise<void> {
      return withToolSpan('updateSlackMessage', { ts, channel }, async () => {
        if (!ts) return;
        if (typeof content === 'string') {
          await slackClient.chat.update({
            channel,
            ts,
            markdown_text: content,
          });
        } else {
          await slackClient.chat.update({
            channel,
            ts,
            blocks: content.blocks,
            text: content.text,
          } as Parameters<webApi.WebClient['chat']['update']>[0]);
        }
      });
    },
    async postNewSlackMessage(content: SlackMessageContent): Promise<string | undefined> {
      return withToolSpan('postNewSlackMessage', { channel, threadTs }, async () => {
        if (typeof content === 'string') {
          const response = await slackClient.chat.postMessage({
            channel,
            thread_ts: threadTs,
            markdown_text: content,
          });
          return response.ts;
        }
        const response = await slackClient.chat.postMessage({
          channel,
          thread_ts: threadTs,
          blocks: content.blocks,
          text: content.text,
        } as Parameters<webApi.WebClient['chat']['postMessage']>[0]);
        return response.ts;
      });
    },
  };
}
