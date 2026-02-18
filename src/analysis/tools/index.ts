import type { GitHubService } from '../github.js';
import { createAITools } from './ai.js';
import { createGitHubTools } from './github.js';
import { lookupSdkRepository } from './sdk-lookup.js';
import { createSlackTools } from './slack.js';
import type { AnalysisTools } from './types.js';
import type { SlackToolsContext } from './slack.js';

export type { AnalysisTools } from './types.js';
export { createSlackTools, type SlackToolsContext } from './slack.js';
export { createGitHubTools } from './github.js';
export { createAITools } from './ai.js';
export { lookupSdkRepository } from './sdk-lookup.js';

export function createAnalysisTools(
  slackContext?: SlackToolsContext | null,
  githubService?: GitHubService | null
): AnalysisTools {
  const slackTools = slackContext
    ? createSlackTools(slackContext)
    : {
        postNewSlackMessage: async (): Promise<undefined> => undefined,
        updateSlackMessage: async (): Promise<void> => {},
      };

  const githubTools = githubService
    ? createGitHubTools(githubService)
    : {
        getReleasesFromVersion: async (): Promise<never[]> => [],
        findAllReleases: async (): Promise<never[]> => [],
        getIssueResolution: async (): Promise<null> => null,
        getPrDetails: async (): Promise<null> => null,
      };

  const aiTools = createAITools();

  return {
    ...aiTools,
    lookupSdkRepository,
    ...slackTools,
    ...githubTools,
  };
}
