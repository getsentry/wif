import type { AnalysisTools } from './tools/index.js';

export type { Result } from './tools/index.js';

export async function analyzeIssue(issueDescription: string, tools: AnalysisTools): Promise<void> {
  const progressTs = await tools.postNewSlackMessage('Analyzing…');
  await tools.updateSlackMessage(progressTs, 'Classifying repository…');

  const result = await tools.classifyRepository(issueDescription);

  await tools.updateSlackMessage(progressTs, 'Classification done.');

  const responseText =
    `*Repository Analysis*\n\n` +
    `*Repository:* ${result.owner}/${result.repo}\n` +
    `*Confidence:* ${result.confidence}\n` +
    (result.sdkVersion ? `*SDK Version:* ${result.sdkVersion}\n` : '') +
    `*Reasoning:* ${result.reasoning}`;

  await tools.postNewSlackMessage(responseText);
}
