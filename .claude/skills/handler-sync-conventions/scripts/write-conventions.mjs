#!/usr/bin/env node
/**
 * write-conventions.mjs — write handler's conventions artifact atomically.
 *
 * Reads a distilled rule set as JSON (from a file path argument, or stdin),
 * validates it, computes the integrity `sourceHash`, stamps `lastSynced`, and
 * writes the versioned artifact to the target path with an atomic
 * temp-file-and-rename. Atomicity is what lets a failed/empty distillation leave
 * any prior artifact untouched: this script only runs after a successful fetch,
 * and if validation fails it exits non-zero *before* the rename, so the old
 * file survives.
 *
 * The hash MUST match handler's `hashRules` (src/core/conventions/staleness.ts)
 * byte-for-byte, or handler will report the freshly-synced artifact as
 * `hash-mismatch`. handler canonicalizes as:
 *   sha256(JSON.stringify({ allowedKeys, cuePatterns, descriptionMinLength, requiredKeys }))
 * with keys in that exact alphabetical order and array element order preserved.
 * Reproducing it here with the same `JSON.stringify` (Node, no spaces) keeps the
 * two byte-identical.
 *
 * Usage:
 *   node write-conventions.mjs <rules.json> [--out <path>]
 *   echo '<rules-json>' | node write-conventions.mjs --out <path>
 *
 * Defaults to ~/.handler/conventions.json when --out is omitted.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Must stay in sync with handler's CONVENTIONS_STORE_VERSION. */
const CONVENTIONS_STORE_VERSION = 1;

function fail(message) {
  process.stderr.write(`write-conventions: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  let rulesPath;
  let out;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith('--') && rulesPath === undefined) {
      rulesPath = arg;
    }
  }
  return { rulesPath, out: out ?? join(homedir(), '.handler', 'conventions.json') };
}

function readRules(rulesPath) {
  const raw = rulesPath ? readFileSync(rulesPath, 'utf8') : readFileSync(0, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`rules input is not valid JSON: ${err.message}`);
  }
}

function isStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string');
}

/** Validate the distilled rule set, accepting only the fields handler reads. */
function validateRules(rules) {
  if (typeof rules !== 'object' || rules === null) {
    fail('rules must be a JSON object');
  }
  if (!isStringArray(rules.requiredKeys)) {
    fail('rules.requiredKeys must be a non-empty array of strings');
  }
  if (!isStringArray(rules.allowedKeys)) {
    fail('rules.allowedKeys must be a non-empty array of strings');
  }
  if (typeof rules.descriptionMinLength !== 'number' || rules.descriptionMinLength <= 0) {
    fail('rules.descriptionMinLength must be a positive number');
  }
  if (!isStringArray(rules.cuePatterns)) {
    fail('rules.cuePatterns must be a non-empty array of strings');
  }
  // requiredKeys should be a subset of allowedKeys, or every definition trips 16e.
  const allowed = new Set(rules.allowedKeys);
  const stray = rules.requiredKeys.filter((k) => !allowed.has(k));
  if (stray.length > 0) {
    fail(`requiredKeys not in allowedKeys: ${stray.join(', ')}`);
  }
  return {
    requiredKeys: rules.requiredKeys,
    allowedKeys: rules.allowedKeys,
    descriptionMinLength: rules.descriptionMinLength,
    cuePatterns: rules.cuePatterns,
  };
}

/** Canonical integrity hash — mirrors handler's hashRules exactly. */
function hashRules(rules) {
  const canonical = JSON.stringify({
    allowedKeys: rules.allowedKeys,
    cuePatterns: rules.cuePatterns,
    descriptionMinLength: rules.descriptionMinLength,
    requiredKeys: rules.requiredKeys,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Write `data` to `out` atomically: stage in a temp file, then rename over it. */
function writeAtomic(out, data) {
  mkdirSync(dirname(out), { recursive: true });
  const staged = join(tmpdir(), `handler-conventions-${process.pid}-${Date.now()}.json`);
  writeFileSync(staged, data, 'utf8');
  renameSync(staged, out);
}

const { rulesPath, out } = parseArgs(process.argv.slice(2));
const rules = validateRules(readRules(rulesPath));
const artifact = {
  version: CONVENTIONS_STORE_VERSION,
  sourceHash: hashRules(rules),
  lastSynced: new Date().toISOString(),
  rules,
};
writeAtomic(out, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(`Wrote conventions artifact to ${out} (sourceHash ${artifact.sourceHash})\n`);
