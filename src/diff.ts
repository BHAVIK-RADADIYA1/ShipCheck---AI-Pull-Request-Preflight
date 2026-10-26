import type { DiffFile, DiffLine, ParsedDiff } from "./types.js";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Split a `diff --git a/x b/y` argument list, honouring git's C-style quoting. */
function splitGitHeader(rest: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < rest.length) {
    if (rest[index] === " ") {
      index += 1;
      continue;
    }

    if (rest[index] === '"') {
      let value = "";
      index += 1;
      while (index < rest.length) {
        const char = rest[index];
        if (char === "\\" && index + 1 < rest.length) {
          const escaped = rest[index + 1] ?? "";
          const known: Record<string, string> = {
            n: "\n",
            t: "\t",
            r: "\r",
            '"': '"',
            "\\": "\\",
          };
          value += known[escaped] ?? escaped;
          index += 2;
        } else if (char === '"') {
          index += 1;
          break;
        } else {
          value += char;
          index += 1;
        }
      }
      tokens.push(value);
    } else {
      let value = "";
      while (index < rest.length && rest[index] !== " ") {
        value += rest[index];
        index += 1;
      }
      tokens.push(value);
    }
  }

  return tokens;
}

function unquotePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return splitGitHeader(trimmed)[0] ?? trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripPrefix(value: string, prefix: "a/" | "b/"): string {
  const path = unquotePath(value);
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function headerPaths(line: string): { oldPath: string; newPath: string } | null {
  const rest = line.slice("diff --git ".length);
  const tokens = splitGitHeader(rest);
  if (tokens.length < 2) return null;
  return {
    oldPath: stripPrefix(tokens[0] ?? "", "a/"),
    newPath: stripPrefix(tokens[1] ?? "", "b/"),
  };
}

function emptyFile(): DiffFile {
  return {
    path: "",
    status: "modified",
    binary: false,
    lines: [],
    added: 0,
    removed: 0,
  };
}

/**
 * Parse `git diff` output into files and changed lines.
 *
 * Only added and removed lines are marked as such; context lines are kept so
 * callers can reason about surrounding code without treating it as changed.
 */
export function parseDiff(raw: string): ParsedDiff {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (line.startsWith("diff --git ")) {
      const paths = headerPaths(line);
      current = emptyFile();
      if (paths) {
        current.oldPath = paths.oldPath;
        current.path = paths.newPath;
      }
      files.push(current);
      inHunk = false;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("new file mode")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = unquotePath(line.slice("rename from ".length));
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = unquotePath(line.slice("rename to ".length));
      continue;
    }
    if (line.startsWith("copy from ")) {
      current.status = "renamed";
      current.oldPath = unquotePath(line.slice("copy from ".length));
      continue;
    }
    if (line.startsWith("copy to ")) {
      current.status = "renamed";
      current.path = unquotePath(line.slice("copy to ".length));
      continue;
    }

    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      current.binary = true;
      continue;
    }

    if (!inHunk && line.startsWith("--- ")) {
      const oldPath = unquotePath(line.slice(4));
      if (oldPath === "/dev/null") {
        current.status = "added";
      } else {
        current.oldPath = stripPrefix(oldPath, "a/");
      }
      continue;
    }

    if (!inHunk && line.startsWith("+++ ")) {
      const newPath = unquotePath(line.slice(4));
      if (newPath === "/dev/null") {
        current.status = "deleted";
      } else {
        current.path = stripPrefix(newPath, "b/");
      }
      continue;
    }

    const hunk = HUNK_HEADER.exec(line);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1] ?? 0);
      newLine = Number(hunk[3] ?? 0);
      continue;
    }

    if (!inHunk) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (line === "") continue;

    const marker = line[0];
    const content = line.slice(1);

    if (marker === "+") {
      const diffLine: DiffLine = { kind: "add", content, newLine };
      current.lines.push(diffLine);
      current.added += 1;
      newLine += 1;
    } else if (marker === "-") {
      const diffLine: DiffLine = { kind: "del", content, oldLine };
      current.lines.push(diffLine);
      current.removed += 1;
      oldLine += 1;
    } else if (marker === " ") {
      current.lines.push({ kind: "context", content, newLine, oldLine });
      newLine += 1;
      oldLine += 1;
    }
  }

  return {
    files: files.filter((file) => file.path !== "" || file.lines.length > 0),
    raw,
  };
}

/**
 * Build a diff entry for a file that exists in the working tree but is not
 * tracked by git yet. `git diff` never includes such files.
 */
export function buildUntrackedFile(path: string, content: string): DiffFile {
  const rows = content.split(/\r?\n/);
  if (rows.length > 0 && rows[rows.length - 1] === "") rows.pop();

  const lines: DiffLine[] = rows.map((line, index) => ({
    kind: "add",
    content: line,
    newLine: index + 1,
  }));

  return {
    path,
    status: "added",
    binary: false,
    untracked: true,
    lines,
    added: lines.length,
    removed: 0,
  };
}

export function countChangedLines(files: DiffFile[]): number {
  return files.reduce((total, file) => total + file.added + file.removed, 0);
}