/**
 * Tier C judge prompt builder.
 *
 * Constructs a deterministic, LLM-ready prompt from a run's definition
 * snapshot, its extracted output, and an optional set of few-shot calibration
 * anchors. This function is pure — no I/O, no network calls. The caller is
 * responsible for extracting the run output (e.g. via `extractRunOutput` from
 * tier-b-contract.ts) before passing it in.
 */
import type { Run } from '../run';
import type { TierCAnchor } from './tier-c';

/**
 * Build a judge prompt for a single run.
 *
 * @param run        - The attributed run being evaluated.
 * @param runOutput  - The pre-extracted final output text of the run.
 * @param anchors    - Optional few-shot calibration examples. When empty,
 *                     the few-shot section is omitted entirely.
 * @returns A structured prompt string ready to send to an LLM judge.
 */
export function buildJudgePrompt(run: Run, runOutput: string, anchors: TierCAnchor[]): string {
  const sections: string[] = [];

  sections.push(buildSystemContext());
  sections.push(buildAgentDefinitionSection(run));
  if (anchors.length > 0) {
    sections.push(buildFewShotSection(anchors));
  }
  sections.push(buildEvaluationSection(runOutput));
  sections.push(buildOutputFormatSection());

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Section builders — each returns a single coherent block of text.
// ---------------------------------------------------------------------------

function buildSystemContext(): string {
  return `You are an impartial quality judge evaluating the output of a Claude Code subagent.

Your task is to determine whether the agent's output fulfills the agent's stated role and purpose as described in its definition. You must evaluate faithfulness to the agent's declared responsibilities, not general quality.`;
}

function buildAgentDefinitionSection(run: Run): string {
  const name = run.agentName;
  const snapshot =
    run.definitionSnapshot !== null
      ? run.definitionSnapshot
      : '(No definition snapshot available for this run.)';

  return `## Agent Definition

Agent name: ${name}

${snapshot}`;
}

function buildFewShotSection(anchors: TierCAnchor[]): string {
  const examples = anchors
    .map((anchor, index) => buildAnchorExample(anchor, index + 1))
    .join('\n\n---\n\n');

  return `## Calibration Examples

The following examples show what a correct evaluation looks like for this agent. Use them to calibrate your judgment.

${examples}`;
}

function buildAnchorExample(anchor: TierCAnchor, index: number): string {
  return `### Example ${index}

**Agent Output:**
${anchor.runOutput}

**Verdict:** ${anchor.score}

**Reasoning:** ${anchor.reasoning}`;
}

function buildEvaluationSection(runOutput: string): string {
  return `## Run Output to Evaluate

${runOutput}`;
}

function buildOutputFormatSection(): string {
  return `## Your Evaluation

Evaluate whether the run output above fulfills the agent's stated role and responsibilities.

Respond with a JSON object containing exactly two fields:
- \`label\`: either \`"pass"\` (the output fulfills the agent's role) or \`"fail"\` (it does not)
- \`reasoning\`: a concise explanation of your verdict (1–3 sentences)

Example response format:
\`\`\`json
{"label": "pass", "reasoning": "The output correctly addressed the agent's stated responsibilities."}
\`\`\`

Respond with only the JSON object — no additional text before or after.`;
}
