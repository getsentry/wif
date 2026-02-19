import type { AnalysisTools } from '../tools/types.js';
import { createCheckExtractedLinksSubtask } from './check-extracted-links.js';
import { createExtractRequestSubtask } from './extract-request.js';
import { createFetchReleaseRangeSubtask } from './fetch-release-range.js';
import { createResolveRepositorySubtask } from './resolve-repository.js';
import { createScanReleaseNotesSubtask } from './scan-release-notes.js';

export type ExtractRequestResult = import('./extract-request.js').ExtractRequestResult;
export type ResolveRepositoryOutput = import('./resolve-repository.js').ResolveRepositoryOutput;
export type CheckExtractedLinksOutput =
  import('./check-extracted-links.js').CheckExtractedLinksOutput;
export type FetchReleaseRangeOutput = import('./fetch-release-range.js').FetchReleaseRangeOutput;
export type ScanReleaseNotesOutput = import('./scan-release-notes.js').ScanReleaseNotesOutput;

export interface AnalysisSubtasks {
  extractRequest(message: string): Promise<ExtractRequestResult>;
  resolveRepository(sdk: string, context?: string): Promise<ResolveRepositoryOutput>;
  checkExtractedLinks(
    links: string[],
    version: string,
    repo: string,
    problem: string,
    issueDescription: string
  ): Promise<CheckExtractedLinksOutput>;
  fetchReleaseRange(repo: string, fromVersion: string): Promise<FetchReleaseRangeOutput>;
  scanReleaseNotes(
    releases: import('../github.js').GitHubRelease[],
    problem: string,
    repo: string,
    issueDescription: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<ScanReleaseNotesOutput>;
}

export function createAnalysisSubtasks(tools: AnalysisTools): AnalysisSubtasks {
  return {
    extractRequest: createExtractRequestSubtask(tools),
    resolveRepository: createResolveRepositorySubtask(tools),
    checkExtractedLinks: createCheckExtractedLinksSubtask(tools),
    fetchReleaseRange: createFetchReleaseRangeSubtask(tools),
    scanReleaseNotes: createScanReleaseNotesSubtask(tools),
  };
}
