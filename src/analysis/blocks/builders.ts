import type { SlackBlock } from '../tools/slack.js';
import { prLinkFor } from '../utils.js';

const SENTRY_TRACE_BASE_URL = 'https://sentry-sdks.sentry.io/explore/traces/trace';

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function context(text: string): SlackBlock {
  return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
}

function divider(): SlackBlock {
  return { type: 'divider' };
}

/** Mrkdwn link: <url|label> */
export function prLinkMrkdwn(repo: string, prNumber: number): string {
  const url = prLinkFor(repo, prNumber);
  return `<${url}|PR #${prNumber}>`;
}

function normalizeVersion(v: string): string {
  return v.replace(/^v/, '');
}

export interface ProgressStep {
  label: string;
  status: 'done' | 'in_progress' | 'pending';
}

/**
 * Build blocks for the in-place progress message (checklist style).
 * Completed steps get :white_check_mark:, current gets a spinner, pending are omitted or shown dimmed.
 */
export function buildProgressBlocks(steps: ProgressStep[]): SlackBlock[] {
  const lines = steps.map((s) => {
    if (s.status === 'done') return `:white_check_mark: ${s.label}`;
    if (s.status === 'in_progress') return `:arrows_counterclockwise: ${s.label}`;
    return `:white_circle: ${s.label}`;
  });
  const header = steps.some((s) => s.status === 'in_progress')
    ? ':hourglass_flowing_sand: *Analyzing…*'
    : ':white_check_mark: *Done*';
  return [section(header), context(lines.length > 0 ? lines.join('\n') : 'Starting…')];
}

export interface TraceFooter {
  checked?: string;
  evaluated?: string;
  skipped?: string;
  traceUrl?: string;
}

function buildTraceContext(footer: TraceFooter): SlackBlock | null {
  const parts: string[] = [];
  if (footer.checked) parts.push(footer.checked);
  if (footer.evaluated) parts.push(footer.evaluated);
  if (footer.skipped) parts.push(footer.skipped);
  if (footer.traceUrl) parts.push(`<${footer.traceUrl}|View trace>`);
  if (parts.length === 0) return null;
  return context(parts.join(' · '));
}

export interface HighConfidenceCandidate {
  version: string;
  prLink: string;
  prNumber?: number;
  reason: string;
}

export interface HighConfidenceParams {
  candidates: HighConfidenceCandidate[];
  repo?: string;
  footer: TraceFooter;
}

export function buildHighConfidenceBlocks(params: HighConfidenceParams): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  const [first] = params.candidates;

  if (params.candidates.length === 1) {
    const prText =
      params.repo && first.prNumber != null
        ? prLinkMrkdwn(params.repo, first.prNumber)
        : first.prLink;
    blocks.push(
      section(`:white_check_mark: *Fixed in v${normalizeVersion(first.version)}*\nSee ${prText}`)
    );
  } else {
    const candidateLines = params.candidates.map(
      (c, i) =>
        `${i + 1}. *v${normalizeVersion(c.version)}* — ${
          params.repo && c.prNumber != null ? prLinkMrkdwn(params.repo, c.prNumber) : c.prLink
        }`
    );
    blocks.push(section(`:white_check_mark: *High-confidence fix candidates found*`));
    blocks.push(section(candidateLines.join('\n')));
  }

  blocks.push(context(`:large_green_circle: *High confidence* — ${first.reason}`));
  blocks.push(divider());

  const traceBlock = buildTraceContext(params.footer);
  if (traceBlock) blocks.push(traceBlock);
  return blocks;
}

export interface MediumCandidate {
  version: string;
  prLink: string;
  prNumber?: number;
}

export interface MediumConfidenceParams {
  candidates: MediumCandidate[];
  repo?: string;
  reason: string;
  footer: TraceFooter;
  maintainerMention?: string;
}

export function buildMediumConfidenceBlocks(params: MediumConfidenceParams): SlackBlock[] {
  const topCandidates = params.candidates.slice(0, 5);
  const candidateLines = topCandidates.map(
    (c, i) =>
      `${i + 1}. *v${normalizeVersion(c.version)}* — ${
        params.repo && c.prNumber != null ? prLinkMrkdwn(params.repo, c.prNumber) : c.prLink
      }`
  );
  const deferLine = params.maintainerMention
    ? `Deferring to SDK maintainers to confirm. ${params.maintainerMention}`
    : 'Deferring to SDK maintainers to confirm.';
  const blocks: SlackBlock[] = [
    section(`:mag: *Potential candidates found*\n${deferLine}`),
    section(candidateLines.join('\n')),
    context(`:large_yellow_circle: *Medium confidence* — ${params.reason}`),
    divider(),
  ];
  const traceBlock = buildTraceContext(params.footer);
  if (traceBlock) blocks.push(traceBlock);
  return blocks;
}

export interface NoResultParams {
  version: string;
  footer: TraceFooter;
  maintainerMention?: string;
}

export function buildNoResultBlocks(params: NoResultParams): SlackBlock[] {
  const deferLine = params.maintainerMention
    ? `Deferring to SDK maintainers for investigation. ${params.maintainerMention}`
    : 'Deferring to SDK maintainers for investigation.';
  const blocks: SlackBlock[] = [
    section(
      `:thinking_face: *No fix identified*\nI wasn't able to identify a fix in releases after \`v${params.version}\`. ${deferLine}`
    ),
    divider(),
  ];
  const traceBlock = buildTraceContext(params.footer);
  if (traceBlock) blocks.push(traceBlock);
  return blocks;
}

export function buildTooOldBlocks(
  version: string,
  skipped?: string,
  maintainerMention?: string
): SlackBlock[] {
  const deferLine = maintainerMention
    ? `Deferring to SDK maintainers. ${maintainerMention}`
    : 'Deferring to SDK maintainers.';
  const text =
    `:warning: *Version too old*\nThe reported version (\`v${version}\`) is more than 100 releases behind the latest stable release. Unable to look this up efficiently.\n${deferLine}` +
    (skipped ? `\n\n${skipped}` : '');
  return [section(text)];
}

export function buildErrorBlocks(errorSummary: string): SlackBlock[] {
  const escaped = errorSummary.replace(/\\/g, '\\\\').replace(/`/g, '` ');
  return [section(`:x: *Something went wrong*\n\`${escaped}\``)];
}

/**
 * Simple informational message (clarification, already_latest, invalid_version, fetch_failed).
 */
export function buildSimpleTextBlocks(
  message: string,
  skipped?: string,
  maintainerMention?: string
): SlackBlock[] {
  const mention = maintainerMention ? ` ${maintainerMention}` : '';
  const text = message + mention + (skipped ? `\n\n${skipped}` : '');
  return [section(`:information_source: ${text}`)];
}

export function addTraceToFooter(footer: TraceFooter, traceId: string | undefined): TraceFooter {
  return {
    ...footer,
    traceUrl: traceId ? `${SENTRY_TRACE_BASE_URL}/${traceId}` : undefined,
  };
}
