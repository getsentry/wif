import { webApi } from '@slack/bolt';
import 'dotenv/config';
import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;
const slackClient = new webApi.WebClient(process.env.SLACK_BOT_TOKEN);
const app = createApp({ slackClient });

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
