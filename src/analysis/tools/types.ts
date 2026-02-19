import type { z } from 'zod';
import type { GitHubRelease } from '../github.js';
import type { SlackMessageContent } from './slack.js';

export interface ExtractedRequest {
  sdk: string | null;
  version: string | null;
  problem: string;
  links?: string[];
}

export interface IssueResolution {
  fixed_in_version: string;
  pr_number: number;
}

export interface PrDetails {
  title: string;
  body: string | null;
}

export interface RelevantEntry {
  release: string;
  line: string;
  pr_reference?: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface ConfidenceResult {
  level: Confidence;
  reason: string;
}

export interface AnalysisTools {
  generateObject<T>(options: { schema: z.ZodType<T>; system: string; prompt: string }): Promise<T>;
  extractRequest(message: string): Promise<ExtractedRequest>;
  lookupSdkRepository(sdk: string): string | null;
  resolveRepositoryAmbiguous(context: string): Promise<string>;
  getIssueResolution(issueUrl: string): Promise<IssueResolution | null>;
  getReleasesFromVersion(repo: string, fromVersion: string): Promise<GitHubRelease[]>;
  findAllReleases(repo: string): Promise<GitHubRelease[]>;
  filterRelevantEntries(releaseNotes: string, problem: string): Promise<RelevantEntry[]>;
  getPrDetails(repo: string, prNumber: number): Promise<PrDetails | null>;
  scorePrConfidence(
    prTitle: string,
    prBody: string | null,
    problem: string
  ): Promise<ConfidenceResult>;
  verifyPrMatch(
    prTitle: string,
    prBody: string | null,
    problem: string,
    issueDescription: string
  ): Promise<{ confirmed: boolean; reason: string }>;
  updateSlackMessage(ts: string | undefined, content: SlackMessageContent): Promise<void>;
  postNewSlackMessage(content: SlackMessageContent): Promise<string | undefined>;
}
