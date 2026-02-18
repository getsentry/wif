import type { GitHubRelease } from '../github.js';
import type { AnalysisTools } from '../tools/types.js';
import { prLinkFor } from '../utils.js';

export interface ScanCandidate {
  version: string;
  prNumber: number;
  prLink: string;
  confidence: 'high' | 'medium';
  reason: string;
}

export interface ScanHighConfidenceResult {
  kind: 'high_confidence';
  candidate: ScanCandidate;
}

export interface ScanMediumResult {
  kind: 'medium';
  candidates: ScanCandidate[];
}

export interface ScanNoResult {
  kind: 'no_result';
}

export type ScanReleaseNotesOutput = ScanHighConfidenceResult | ScanMediumResult | ScanNoResult;

const BATCH_SIZE = 5;

function extractPrNumber(prRef: string | undefined): number | null {
  if (!prRef) return null;
  const match = prRef.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export function createScanReleaseNotesSubtask(
  tools: Pick<AnalysisTools, 'filterRelevantEntries' | 'getPrDetails' | 'scorePrConfidence'>
) {
  return async function scanReleaseNotes(
    releases: GitHubRelease[],
    problem: string,
    repo: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<ScanReleaseNotesOutput> {
    const candidates: ScanCandidate[] = [];

    for (let i = 0; i < releases.length; i += BATCH_SIZE) {
      const batch = releases.slice(i, i + BATCH_SIZE);
      const releaseNotes = batch.map((r) => `## ${r.tag}\n${r.body ?? ''}`).join('\n\n');

      const entries = await tools.filterRelevantEntries(releaseNotes, problem);

      for (const entry of entries) {
        const prNumber = extractPrNumber(entry.pr_reference) ?? extractPrNumber(entry.line);
        if (!prNumber) continue;

        const prDetails = await tools.getPrDetails(repo, prNumber);
        if (!prDetails) continue;

        const { level, reason } = await tools.scorePrConfidence(
          prDetails.title,
          prDetails.body,
          problem
        );

        if (level === 'high') {
          return {
            kind: 'high_confidence',
            candidate: {
              version: entry.release,
              prNumber,
              prLink: prLinkFor(repo, prNumber),
              confidence: 'high',
              reason,
            },
          };
        }

        if (level === 'medium') {
          candidates.push({
            version: entry.release,
            prNumber,
            prLink: prLinkFor(repo, prNumber),
            confidence: 'medium',
            reason,
          });
        }
      }

      onProgress?.(Math.min(i + BATCH_SIZE, releases.length), releases.length);
    }

    if (candidates.length > 0) {
      return { kind: 'medium', candidates };
    }

    return { kind: 'no_result' };
  };
}
