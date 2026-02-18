import { webApi } from '@slack/bolt';
import * as Sentry from '@sentry/node';
import express, { Request, Response } from 'express';
import PQueue from 'p-queue';
import { createSlackVerificationMiddleware, httpErrorHandler } from './middleware/index.js';
import type { SlackWebhookBody } from './types.js';
import { processSlackWebhook } from './worker.js';

export interface CreateAppOptions {
  slackClient?: webApi.WebClient;
}

export function createApp(options?: CreateAppOptions) {
  const app = express();
  const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  const slackClient = options?.slackClient ?? new webApi.WebClient(process.env.SLACK_BOT_TOKEN);
  const queue = new PQueue({ concurrency: 1 });

  app.use(
    express.json({
      verify: createSlackVerificationMiddleware(SLACK_SIGNING_SECRET),
    })
  );

  app.use(httpErrorHandler);

  app.post('/api/webhooks/slack', async (req: Request, res: Response) => {
    const body = req.body as SlackWebhookBody;

    if (body.type === 'url_verification') {
      return res.status(200).json({ challenge: body.challenge });
    }

    // At this point, we know it's an EnvelopedEvent
    if (body.event?.type === 'app_mention') {
      const { channel, ts } = body.event;
      await slackClient.reactions
        .add({ channel, timestamp: ts, name: 'hourglass' })
        .catch(() => {});
    }

    queue
      .add(() => processSlackWebhook(body, { slackClient }))
      .catch((reason) => {
        console.error('Error processing job:', reason);
        Sentry.captureException(reason);
      });

    res.status(200).send('OK');
  });

  app.get('/api/health', (req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  Sentry.setupExpressErrorHandler(app);

  return app;
}
