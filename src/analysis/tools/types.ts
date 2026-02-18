import type { Result } from './classifier.js';
import type { GitHubRelease } from '../github.js';

export interface AnalysisTools {
  classifyRepository(issueDescription: string): Promise<Result>;
  updateSlackMessage(ts: string | undefined, text: string): Promise<void>;
  postNewSlackMessage(text: string): Promise<string | undefined>;
  getReleasesFromVersion(repo: string, fromVersion: string): Promise<GitHubRelease[]>;
  findAllReleases(repo: string): Promise<GitHubRelease[]>;
}
