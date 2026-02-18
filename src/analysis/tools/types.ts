import type { z } from 'zod';
import type { GitHubRelease } from '../github.js';

export interface AnalysisTools {
  generateObject<T>(options: {
    schema: z.ZodType<T>;
    system: string;
    prompt: string;
  }): Promise<T>;
  updateSlackMessage(ts: string | undefined, text: string): Promise<void>;
  postNewSlackMessage(text: string): Promise<string | undefined>;
  getReleasesFromVersion(repo: string, fromVersion: string): Promise<GitHubRelease[]>;
  findAllReleases(repo: string): Promise<GitHubRelease[]>;
}
