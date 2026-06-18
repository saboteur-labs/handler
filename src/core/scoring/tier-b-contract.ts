/**
 * Output-contract detection and adherence check for Tier B scoring.
 *
 * Conservative by design: biases toward false-negatives (misses a contract
 * rather than false-alarming on one that isn't there). Detection uses a small,
 * pinned marker set — do not expand without updating the corresponding tests.
 */
import { readJsonl } from '../transcripts/jsonl';
import type { Run } from '../run';
import type { TierBContractResult } from './tier-b';

/** The two contract types we detect. */
export type ContractType = 'json' | 'sections';

/** A contract detected in a definition snapshot. */
export interface DetectedContract {
  /** Which type of contract was found. */
  type: ContractType;
  /** Human-readable description of what was found. */
  detail: string;
}

// ---------------------------------------------------------------------------
// Exact JSON contract phrase markers (case-insensitive substring match).
// ---------------------------------------------------------------------------
const JSON_PHRASES: readonly string[] = [
  'return json',
  'output json',
  'respond with json',
  'output must be json',
  'output should be json',
  'always output json',
];

/** Matches a fenced ```json ... ``` block. */
const JSON_FENCE_RE = /```json\n[\s\S]*?```/i;

// ---------------------------------------------------------------------------
// Sections contract: ## <Name> where Name is one of the approved headers.
// ---------------------------------------------------------------------------
const SECTION_NAMES = ['output', 'response', 'result', 'format'];
const SECTION_HEADER_RE = new RegExp(`^##\\s+(${SECTION_NAMES.join('|')})\\s*$`, 'im');

// ---------------------------------------------------------------------------
// Sections check markers (for output adherence).
// ---------------------------------------------------------------------------
const OUTPUT_SECTION_RE = /^##\s+(output|response|result|format)\s*$/im;

/**
 * Detect whether a definition snapshot declares an explicit output contract.
 *
 * Returns `null` when no contract is detected (the common case — bias toward
 * false-negatives). When both JSON and sections markers are present, JSON wins.
 */
export function detectContract(definitionSnapshot: string | null): DetectedContract | null {
  if (definitionSnapshot === null) {
    return null;
  }

  const lower = definitionSnapshot.toLowerCase();

  // JSON contract check — phrases first, then fenced block.
  const matchedPhrase = JSON_PHRASES.find((phrase) => lower.includes(phrase));
  if (matchedPhrase !== undefined) {
    return { type: 'json', detail: `phrase "${matchedPhrase}" found in definition` };
  }
  if (JSON_FENCE_RE.test(definitionSnapshot)) {
    return { type: 'json', detail: 'fenced ```json block found in definition' };
  }

  // Sections contract check.
  if (SECTION_HEADER_RE.test(definitionSnapshot)) {
    return { type: 'sections', detail: '## section header found in definition' };
  }

  return null;
}

/**
 * Extract the run's final output text from its sidechain transcript.
 *
 * Reads the last entry whose `message.content` is a non-empty string from the
 * sidechain JSONL. Returns `null` when the sidechain is unavailable or no
 * such entry exists.
 */
export function extractRunOutput(run: Run): string | null {
  if (run.sidechainPath === undefined) {
    return null;
  }

  const entries = readJsonl(run.sidechainPath);
  let lastContent: string | null = null;

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }
    const message = entry['message'];
    if (!isRecord(message)) {
      continue;
    }
    const content = message['content'];
    if (typeof content === 'string' && content.length > 0) {
      lastContent = content;
    }
  }

  return lastContent;
}

/**
 * Check whether a run's output satisfies any contract declared in its
 * definition snapshot.
 *
 * Returns `not-applicable` when no contract is detected or when the run
 * output cannot be located — never fails a run it cannot verify.
 */
export function checkContract(run: Run): TierBContractResult {
  const detected = detectContract(run.definitionSnapshot);

  if (detected === null) {
    return { status: 'not-applicable' };
  }

  const output = extractRunOutput(run);

  if (output === null) {
    return {
      status: 'not-applicable',
      contractType: detected.type,
      detail: 'run output not available',
    };
  }

  if (detected.type === 'json') {
    try {
      JSON.parse(output.trim());
      return { status: 'pass', contractType: 'json', detail: 'output is valid JSON' };
    } catch {
      return { status: 'fail', contractType: 'json', detail: 'output is not valid JSON' };
    }
  }

  // sections contract
  if (OUTPUT_SECTION_RE.test(output)) {
    return {
      status: 'pass',
      contractType: 'sections',
      detail: 'output contains declared section headers',
    };
  }
  return {
    status: 'fail',
    contractType: 'sections',
    detail: 'output does not contain declared section headers',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
