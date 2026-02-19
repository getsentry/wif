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
  candidates: ScanCandidate[];
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
const MAX_HIGH_CANDIDATES = 3;
const MAX_MEDIUM_CANDIDATES = 5;

function extractPrNumber(prRef: string | undefined): number | null {
  if (!prRef) return null;
  const match = prRef.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export function createScanReleaseNotesSubtask(
  tools: Pick<
    AnalysisTools,
    'filterRelevantEntries' | 'getPrDetails' | 'scorePrConfidence' | 'verifyPrMatch'
  >
) {
  return async function scanReleaseNotes(
    releases: GitHubRelease[],
    problem: string,
    repo: string,
    issueDescription: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<ScanReleaseNotesOutput> {
    const highCandidates: ScanCandidate[] = [];
    const mediumCandidates: ScanCandidate[] = [];

    for (let i = 0; i < releases.length; i += BATCH_SIZE) {
      const batch = releases.slice(i, i + BATCH_SIZE);
      const releaseNotes = batch.map((r) => `## ${r.tag}\n${r.body ?? ''}`).join('\n\n');

      const entries = await tools.filterRelevantEntries(releaseNotes, problem, issueDescription);

      for (const entry of entries) {
        const prNumber = extractPrNumber(entry.pr_reference) ?? extractPrNumber(entry.line);
        if (!prNumber) continue;

        const prDetails = await tools.getPrDetails(repo, prNumber);
        if (!prDetails) continue;

        const { level, reason } = await tools.scorePrConfidence(
          prDetails.title,
          prDetails.body,
          problem,
          issueDescription
        );

        if (level === 'high') {
          const verification = await tools.verifyPrMatch(
            prDetails.title,
            prDetails.body,
            problem,
            issueDescription
          );
          if (verification.confirmed) {
            highCandidates.push({
              version: entry.release,
              prNumber,
              prLink: prLinkFor(repo, prNumber),
              confidence: 'high',
              reason,
            });
            if (highCandidates.length >= MAX_HIGH_CANDIDATES) {
              return { kind: 'high_confidence', candidates: highCandidates };
            }
            continue;
          }
          if (mediumCandidates.length < MAX_MEDIUM_CANDIDATES) {
            mediumCandidates.push({
              version: entry.release,
              prNumber,
              prLink: prLinkFor(repo, prNumber),
              confidence: 'medium',
              reason: verification.reason,
            });
          }
          continue;
        }

        if (level === 'medium' && mediumCandidates.length < MAX_MEDIUM_CANDIDATES) {
          mediumCandidates.push({
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

    if (highCandidates.length > 0) {
      return { kind: 'high_confidence', candidates: highCandidates };
    }

    if (mediumCandidates.length > 0) {
      return { kind: 'medium', candidates: mediumCandidates };
    }

    return { kind: 'no_result' };
  };
}
