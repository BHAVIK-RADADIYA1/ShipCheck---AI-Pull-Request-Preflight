import type { Finding, ParsedDiff } from "../types.js";
import { addedLines, isDocumentation, shouldScanText } from "./util.js";

interface TokenPattern {
  id: string;
  label: string;
  pattern: RegExp;
}

/**
 * High-confidence credential shapes. These run on every scanned file,
 * including documentation, because the shape is specific enough to trust.
 */
const TOKEN_PATTERNS: TokenPattern[] = [
  {
    id: "aws-access-key",
    label: "AWS access key ID",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: "github-token",
    label: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/,
  },
  {
    id: "slack-token",
    label: "Slack token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    id: "stripe-live-key",
    label: "Stripe live secret key",
    pattern: /\bsk_live_[0-9A-Za-z]{24,}\b/,
  },
  {
    id: "google-api-key",
    label: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: "private-key-block",
    label: "Private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: "jwt",
    label: "JSON Web Token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

/** Generic `key = "value"` assignments, checked with extra false-positive filters. */
const GENERIC_ASSIGNMENT =
  /(?:api[_-]?key|apikey|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|token|password|passwd|pwd|client[_-]?secret|private[_-]?key)\s*[:=]\s*(["'`])([^"'`]{8,})\1/i;

const PLACEHOLDER_VALUE =
  /(example|sample|dummy|placeholder|change[_-]?me|replace[_-]?me|your[_-]|redacted|not[_-]?real|fake|mock|demo|secret|token|password|passwd|insert|undefined|null|none|xxxx)/i;

const ENV_REFERENCE =
  /(process\.env|import\.meta\.env|os\.environ|os\.getenv|getenv\s*\(|env\s*\(|Deno\.env|System\.getenv|\$\{|\{\{|<[^>]+>|%[A-Za-z_]+%)/;

const ALLOWLIST_COMMENT = /shipcheck:ignore|allowlist\s+secret|gitleaks:allow|nosecret/i;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function looksLikePlaceholder(value: string): boolean {
  if (PLACEHOLDER_VALUE.test(value)) return true;
  if (ENV_REFERENCE.test(value)) return true;
  if (/^(.)\1+$/.test(value)) return true;
  if (/^[*xX0-9_-]+$/.test(value)) return true;
  // Environment-variable or constant names are not credentials.
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(value)) return true;
  return false;
}

function genericMatch(line: string): string | null {
  const match = GENERIC_ASSIGNMENT.exec(line);
  if (!match) return null;
  const value = match[2] ?? "";
  if (looksLikePlaceholder(value)) return null;
  if (shannonEntropy(value) < 2.5) return null;
  return "hard-coded credential";
}

/**
 * Replace credential-shaped text with a marker. Used on optional model output
 * before it reaches a report, as defence in depth against an echo of the diff.
 */
export function redactCredentialLike(text: string): string {
  let output = text;
  for (const pattern of TOKEN_PATTERNS) {
    const flags = pattern.pattern.flags.includes("g")
      ? pattern.pattern.flags
      : `${pattern.pattern.flags}g`;
    output = output.replace(new RegExp(pattern.pattern.source, flags), `[redacted: ${pattern.label}]`);
  }

  output = output.replace(
    new RegExp(GENERIC_ASSIGNMENT.source, "gi"),
    (match: string, _quote: string, value: string) =>
      looksLikePlaceholder(value) ? match : match.replace(value, "[redacted]"),
  );

  return output;
}

/** True when a line looks like it carries a real credential. */
export function containsLikelySecret(line: string): boolean {
  if (ALLOWLIST_COMMENT.test(line)) return false;
  for (const pattern of TOKEN_PATTERNS) {
    if (pattern.pattern.test(line)) return true;
  }
  return genericMatch(line) !== null;
}

/**
 * Detect credentials in added lines. Matched values are never included in a
 * finding or report; only the pattern label and location are reported.
 */
export function checkSecrets(diff: ParsedDiff): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const { file, line } of addedLines(diff)) {
    if (!shouldScanText(file.path)) continue;
    if (ALLOWLIST_COMMENT.test(line.content)) continue;

    const labels: string[] = [];
    for (const pattern of TOKEN_PATTERNS) {
      if (pattern.pattern.test(line.content)) labels.push(pattern.label);
    }

    if (!isDocumentation(file.path)) {
      const generic = genericMatch(line.content);
      if (generic && labels.length === 0) labels.push(generic);
    }

    if (labels.length === 0) continue;

    const key = `${file.path}:${line.newLine ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      check: "secrets",
      severity: "blocking",
      title: `Possible secret: ${[...new Set(labels)].join(", ")}`,
      file: file.path,
      line: line.newLine,
      detail: "The matched value is withheld from this report. Remove the credential and rotate it.",
    });
  }

  return findings;
}