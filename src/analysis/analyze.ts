import * as Sentry from '@sentry/node';
import {
  addTraceToFooter,
  buildHighConfidenceBlocks,
  buildMediumConfidenceBlocks,
  buildNoResultBlocks,
  buildProgressBlocks,
  buildSimpleTextBlocks,
  buildTooOldBlocks,
  prLinkMrkdwn,
} from './blocks/index.js';
import type { ProgressStep } from './blocks/index.js';
import type { AnalysisSubtasks, ScanReleaseNotesOutput } from './subtasks/index.js';
import type { AnalysisTools } from './tools/index.js';

export type AnalysisResult = { message: string } & (
  | { kind: 'high_confidence'; version: string; prLink: string; prNumber: number; reason: string }
  | {
      kind: 'medium_confidence';
      version: string;
      prLink: string;
      prNumber: number;
      reason: string;
      candidates: Array<{ version: string; prLink: string; prNumber: number; reason: string }>;
    }
  | { kind: 'no_result' }
  | { kind: 'too_old' }
  | { kind: 'already_latest' }
  | { kind: 'invalid_version' }
  | { kind: 'fetch_failed' }
  | { kind: 'clarification' }
);

export async function analyzeIssue(
  issueDescription: string,
  tools: AnalysisTools,
  subtasks: AnalysisSubtasks
): Promise<AnalysisResult> {
  const traceId = Sentry.getActiveSpan()?.spanContext().traceId;

  const progressSteps: ProgressStep[] = [{ label: 'Analyzing…', status: 'in_progress' }];
  const progressTs = await tools.postNewSlackMessage({
    blocks: buildProgressBlocks(progressSteps),
    text: 'Analyzing…',
  });

  const appendProgress = async (line: string): Promise<void> => {
    progressSteps.forEach((s) => {
      if (s.status === 'in_progress') s.status = 'done';
    });
    progressSteps.push({ label: line, status: 'in_progress' });
    await tools.updateSlackMessage(progressTs, {
      blocks: buildProgressBlocks(progressSteps),
      text: line,
    });
  };

  const extractResult = await subtasks.extractRequest(issueDescription);
  if (extractResult.kind === 'clarification') {
    await appendProgress(extractResult.message);
    await tools.postNewSlackMessage({
      blocks: buildSimpleTextBlocks(extractResult.message),
      text: extractResult.message,
    });
    return { kind: 'clarification', message: extractResult.message };
  }

  const { sdk, version, problem, links } = extractResult;

  const resolveResult = await subtasks.resolveRepository(sdk, issueDescription);
  if (resolveResult.kind === 'clarification') {
    await appendProgress(resolveResult.message);
    await tools.postNewSlackMessage({
      blocks: buildSimpleTextBlocks(resolveResult.message),
      text: resolveResult.message,
    });
    return { kind: 'clarification', message: resolveResult.message };
  }

  const repo = resolveResult.repo;

  const skippedSteps: string[] = [];

  if (links && links.length > 0) {
    await appendProgress('Checking linked issues…');
    const linkResult = await subtasks.checkExtractedLinks(links, version, repo, problem);
    if (linkResult.kind === 'high_confidence') {
      const result: AnalysisResult = {
        message: '',
        kind: 'high_confidence',
        version: linkResult.version,
        prLink: linkResult.prLink,
        prNumber: linkResult.prNumber,
        reason: linkResult.reason,
      };
      await postResult(
        tools,
        progressTs,
        result,
        {
          repo,
          firstRelease: linkResult.version,
          lastRelease: linkResult.version,
          releaseCount: 1,
          evaluatedPrNumbers: [linkResult.prNumber],
          skippedSteps,
          traceId,
        },
        appendProgress
      );
      return result;
    }
    if (linkResult.skippedLinks?.length) {
      for (const { url, reason } of linkResult.skippedLinks) {
        skippedSteps.push(`Could not check link ${url}: ${reason}`);
      }
    }
  }

  await appendProgress(`Resolving releases for ${repo} after v${version}…`);

  const fetchResult = await subtasks.fetchReleaseRange(repo, version);

  if (fetchResult.kind === 'too_old') {
    const result: AnalysisResult = { kind: 'too_old', message: fetchResult.message };
    await postResult(
      tools,
      progressTs,
      result,
      {
        repo,
        version,
        releaseCount: 0,
        skippedSteps,
        traceId,
      },
      appendProgress
    );
    return result;
  }

  if (fetchResult.kind === 'already_latest') {
    const result: AnalysisResult = {
      kind: 'already_latest',
      message: fetchResult.message,
    };
    await postResult(
      tools,
      progressTs,
      result,
      {
        repo,
        version,
        releaseCount: 0,
        skippedSteps,
        traceId,
      },
      appendProgress
    );
    return result;
  }

  if (fetchResult.kind === 'invalid_version') {
    const result: AnalysisResult = {
      kind: 'invalid_version',
      message: fetchResult.message,
    };
    await postResult(
      tools,
      progressTs,
      result,
      { repo, version, skippedSteps, traceId },
      appendProgress
    );
    return result;
  }

  if (fetchResult.kind === 'fetch_failed') {
    const result: AnalysisResult = {
      kind: 'fetch_failed',
      message: fetchResult.message,
    };
    await postResult(
      tools,
      progressTs,
      result,
      { repo, version, skippedSteps, traceId },
      appendProgress
    );
    return result;
  }

  const releases = fetchResult.releases;
  const firstRelease = releases[0]?.tag ?? version;
  const lastReleaseInRange = releases[releases.length - 1]?.tag ?? version;

  await appendProgress(
    `Scanning releases \`${firstRelease}\`–\`${lastReleaseInRange}\` (\`${releases.length}\` releases)…`
  );

  const scanResult = await subtasks.scanReleaseNotes(releases, problem, repo, (done, total) => {
    appendProgress(`Scanned \`${done}\` of \`${total}\` releases…`);
  });

  const result = mapScanResultToAnalysisResult(scanResult);

  const lastRelease =
    result.kind === 'high_confidence'
      ? result.version
      : (releases[releases.length - 1]?.tag ?? version);
  await postResult(
    tools,
    progressTs,
    result,
    {
      repo,
      firstRelease,
      lastRelease,
      releaseCount: releases.length,
      version,
      evaluatedPrNumbers:
        result.kind === 'high_confidence'
          ? [result.prNumber]
          : result.kind === 'medium_confidence'
            ? result.candidates.map((c) => c.prNumber)
            : [],
      skippedSteps,
      traceId,
    },
    appendProgress
  );

  return result;
}

function mapScanResultToAnalysisResult(scan: ScanReleaseNotesOutput): AnalysisResult {
  if (scan.kind === 'high_confidence') {
    return {
      message: '',
      kind: 'high_confidence',
      version: scan.candidate.version,
      prLink: scan.candidate.prLink,
      prNumber: scan.candidate.prNumber,
      reason: scan.candidate.reason,
    };
  }
  if (scan.kind === 'medium') {
    const best = scan.candidates[0];
    return {
      message: '',
      kind: 'medium_confidence',
      version: best.version,
      prLink: best.prLink,
      prNumber: best.prNumber,
      reason: best.reason,
      candidates: scan.candidates.map((c) => ({
        version: c.version,
        prLink: c.prLink,
        prNumber: c.prNumber,
        reason: c.reason,
      })),
    };
  }
  return { kind: 'no_result', message: '' };
}

interface PostResultContext {
  repo?: string;
  firstRelease?: string;
  lastRelease?: string;
  releaseCount?: number;
  version?: string;
  evaluatedPrs?: string[];
  evaluatedPrNumbers?: number[];
  skippedSteps?: string[];
  traceId?: string;
}

async function postResult(
  tools: AnalysisTools,
  progressTs: string | undefined,
  result: AnalysisResult,
  ctx: PostResultContext,
  appendProgress: (line: string) => Promise<void>
): Promise<void> {
  const checked =
    ctx.firstRelease && ctx.lastRelease && ctx.repo
      ? `Checked releases \`${ctx.firstRelease}\`–\`${ctx.lastRelease}\` in \`${ctx.repo}\``
      : ctx.version
        ? `Checked version \`${ctx.version}\``
        : '';
  const evaluated =
    ctx.evaluatedPrNumbers && ctx.evaluatedPrNumbers.length > 1 && ctx.repo
      ? `Relevant PRs evaluated: ${ctx.evaluatedPrNumbers.map((n) => prLinkMrkdwn(ctx.repo!, n)).join(', ')}`
      : ctx.releaseCount !== undefined &&
          (!ctx.evaluatedPrNumbers || ctx.evaluatedPrNumbers.length === 0)
        ? `Release notes reviewed: ${ctx.releaseCount}`
        : '';
  const skipped =
    ctx.skippedSteps && ctx.skippedSteps.length > 0
      ? `Skipped steps: ${ctx.skippedSteps.join('; ')}`
      : '';

  const footer = addTraceToFooter(
    {
      checked: checked || undefined,
      evaluated: evaluated || undefined,
      skipped: skipped || undefined,
    },
    ctx.traceId
  );

  let blocks: ReturnType<typeof buildHighConfidenceBlocks>;
  let fallbackText: string;

  switch (result.kind) {
    case 'high_confidence':
      blocks = buildHighConfidenceBlocks({
        version: result.version,
        prLink: result.prLink,
        repo: ctx.repo,
        prNumber: result.prNumber,
        reason: result.reason,
        footer,
      });
      fallbackText = `Fixed in v${result.version}. See PR #${result.prNumber}.`;
      break;
    case 'medium_confidence': {
      blocks = buildMediumConfidenceBlocks({
        candidates: result.candidates.map((c) => ({
          version: c.version,
          prLink: c.prLink,
          prNumber: c.prNumber,
        })),
        repo: ctx.repo,
        reason: result.reason,
        footer,
      });
      fallbackText = `Potential candidates: ${result.candidates.map((c) => `v${c.version} PR #${c.prNumber}`).join(', ')}.`;
      break;
    }
    case 'no_result':
      blocks = buildNoResultBlocks({
        version: ctx.version ?? '?',
        footer,
      });
      fallbackText = `No fix identified in releases after v${ctx.version ?? '?'}.`;
      break;
    case 'too_old':
      blocks = buildTooOldBlocks(ctx.version ?? '?', skipped || undefined);
      fallbackText = `Version v${ctx.version ?? '?'} is too old.`;
      break;
    case 'already_latest':
    case 'invalid_version':
    case 'fetch_failed':
    case 'clarification':
      blocks = buildSimpleTextBlocks(result.message, skipped || undefined);
      fallbackText = result.message;
      break;
  }

  await appendProgress('Done.');
  await tools.postNewSlackMessage({ blocks, text: fallbackText });
}
