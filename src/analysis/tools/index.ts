import type { GitHubService } from '../github.js';
import { createClassifierTools } from './classifier.js';
import { createGitHubTools } from './github.js';
import { createSlackTools } from './slack.js';
import type { AnalysisTools } from './types.js';
import type { SlackToolsContext } from './slack.js';

export type { AnalysisTools } from './types.js';
export type { Result } from './classifier.js';
export { createSlackTools, type SlackToolsContext } from './slack.js';
export { createGitHubTools } from './github.js';
export { createClassifierTools } from './classifier.js';

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
      };

  return { ...createClassifierTools(), ...slackTools, ...githubTools };
}
