/**
 * Error pattern registry — matches common CLI errors to helpful explanations
 * and fix suggestions. Used by KnowledgeToast component.
 */

export interface ErrorPattern {
  id: string;
  title: string;
  explanation: string;
  suggestion: string;
  docsUrl?: string;
  commandFix?: string;
}

/** Test a command block's output against known error patterns. Returns first match or null. */
export function matchErrorPattern(output: string, command: string): ErrorPattern | null {
  const lower = output.toLowerCase();
  const combined = `${command}\n${lower}`;

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(combined, lower, command)) {
      return pattern.result;
    }
  }
  return null;
}

interface PatternMatcher {
  test: (_combined: string, outputLower: string, _command: string) => boolean;
  result: ErrorPattern;
}

const ERROR_PATTERNS: PatternMatcher[] = [
  // ── Filesystem Errors ──────────────────────────────────────
  {
    test: (_c: string, out: string, _cmd: string) => /enoent|no such file or directory|cannot find/i.test(out),
    result: {
      id: "enoent",
      title: "File Not Found",
      explanation: "The specified file or directory does not exist at that path.",
      suggestion: "Check the path for typos. Use `ls` or `dir` to verify the file exists.",
      commandFix: "ls",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /eacces|permission denied|access is denied/i.test(out),
    result: {
      id: "permission",
      title: "Permission Denied",
      explanation: "You don't have permission to access this file or directory.",
      suggestion: "Try running with elevated privileges (admin terminal) or check file permissions.",
      commandFix: "",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /enospc|no space left on device|disk full/i.test(out),
    result: {
      id: "nospace",
      title: "Disk Full",
      explanation: "The disk has run out of free space.",
      suggestion: "Free up space by removing unnecessary files (node_modules, build artifacts, temp files).",
      commandFix: "npm cache clean --force",
    },
  },

  // ── Network/Port Errors ─────────────────────────────────────
  {
    test: (_c: string, out: string, _cmd: string) => /eaddrinuse|address already in use|port.*already in use/i.test(out),
    result: {
      id: "eaddrinuse",
      title: "Port Already in Use",
      explanation: "Another process is already using this port.",
      suggestion: "Find and kill the process using the port, or use a different port.",
      commandFix: "netstat -ano | findstr :3000",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /econnrefused|connect.*refused|could not connect/i.test(out),
    result: {
      id: "econnrefused",
      title: "Connection Refused",
      explanation: "The target service isn't running or isn't accepting connections.",
      suggestion: "Make sure the server/service is started before connecting.",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /enotfound|getaddrinfo.*failed|dns.*fail/i.test(out),
    result: {
      id: "dns-fail",
      title: "DNS Resolution Failed",
      explanation: "The hostname could not be resolved to an IP address.",
      suggestion: "Check your internet connection, DNS settings, or verify the hostname is correct.",
    },
  },

  // ── npm Errors ──────────────────────────────────────────────
  {
    test: (_c: string, out: string, cmd: string) =>
      /npm err!/i.test(out) && (cmd.includes("npm") || /npm/.test(cmd)),
    result: {
      id: "npm-err",
      title: "npm Error",
      explanation: "An npm operation failed — usually a missing dependency, version conflict, or script error.",
      suggestion: "Try clearing node_modules and reinstalling: `rm -rf node_modules && npm install`.",
      commandFix: "rm -rf node_modules package-lock.json && npm install",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /missing script|script.*not found/i.test(out),
    result: {
      id: "missing-script",
      title: "Missing Script",
      explanation: "The requested npm script doesn't exist in package.json.",
      suggestion: "Check available scripts with `npm run` or inspect your package.json scripts section.",
      commandFix: "npm run",
    },
  },

  // ── Git Errors ──────────────────────────────────────────────
  {
    test: (_c: string, out: string, _cmd: string) => /merge conflict|both modified|conflict.*content/i.test(out),
    result: {
      id: "git-conflict",
      title: "Git Merge Conflict",
      explanation: "Two branches changed the same lines in conflicting ways.",
      suggestion: "Resolve conflicts by editing the marked files, then `git add` and `git commit`.",
      commandFix: "git status",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /detached head state/i.test(out),
    result: {
      id: "detached-head",
      title: "Detached HEAD State",
      explanation: "You're not on any branch — commits here won't belong to a named branch.",
      suggestion: "Create a new branch from this state or checkout an existing branch.",
      commandFix: "git checkout -b my-fix-branch",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /non-fast-forward|pull.*merge|diverging histories/i.test(out),
    result: {
      id: "divergent-history",
      title: "Divergent Git History",
      explanation: "The remote has commits that aren't in your local history (and vice versa).",
      suggestion: "Pull with rebase: `git pull --rebase` to keep history linear.",
      commandFix: "git pull --rebase",
    },
  },

  // ── Cargo/Rust Errors ───────────────────────────────────────
  {
    test: (_c: string, out: string, _cmd: string) => /cargo.*error|error\[e/i.test(out) && /cargo/.test(out),
    result: {
      id: "cargo-error",
      title: "Cargo Build Error",
      explanation: "The Rust project failed to compile — usually a type mismatch or missing dependency.",
      suggestion: "Read the error message carefully for the file and line number. Common fixes: add `use` statements, fix types, update dependencies.",
      commandFix: "cargo check 2>&1 | head -50",
    },
  },

  // ── TypeScript/Build Errors ─────────────────────────────────
  {
    test: (_c: string, out: string, _cmd: string) => /typescript error|ts\d{4}/i.test(out),
    result: {
      id: "ts-error",
      title: "TypeScript Error",
      explanation: "A type checking error prevented compilation.",
      suggestion: "Look for TS error codes (TSxxxx) in the output — each maps to a specific issue.",
      docsUrl: "https://www.typescriptlang.org/docs/handbook/error-messages.html",
    },
  },
  {
    test: (_c: string, out: string, _cmd: string) => /cannot find module|module.*not found/i.test(out),
    result: {
      id: "module-not-found",
      title: "Module Not Found",
      explanation: "A required module couldn't be resolved — likely missing from node_modules or wrong import path.",
      suggestion: "Run `npm install` to ensure dependencies are installed. Check import paths for typos.",
      commandFix: "npm install",
    },
  },

  // ── Memory/OOM ──────────────────────────────────────────────
  {
    test: (_c: string, out: string, _cmd: string) => /heap out of memory|oom|javascript heap|fatal allocation/i.test(out),
    result: {
      id: "oom",
      title: "Out of Memory",
      explanation: "Node.js ran out of heap memory during this operation.",
      suggestion: "Increase Node's memory limit: set NODE_OPTIONS=--max-old-space-size=4096 before running.",
      commandFix: "set NODE_OPTIONS=--max-old-space-size=4096",
    },
  },

  // ── Python Errors ───────────────────────────────────────────
  {
    test: (_c: string, out: string, _cmd: string) => /(modulenotfounderror|importerror)/i.test(out),
    result: {
      id: "py-import",
      title: "Python Import Error",
      explanation: "A Python module couldn't be found — it's either not installed or not in PYTHONPATH.",
      suggestion: "Install the missing package with pip: `pip install <package-name>`.",
      commandFix: "pip install -r requirements.txt",
    },
  },

  // ── General Command Not Found ───────────────────────────────
  {
    test: (_c: string, out: string, cmd: string) =>
      /is not recognized|command not found|not (an internal|a recognized)/i.test(out)
      && !/npm err|ENOENT|EACCES/i.test(out),
    result: {
      id: "cmd-not-found",
      title: "Command Not Found",
      explanation: "The shell doesn't recognize this command — it may not be installed or not on PATH.",
      suggestion: "Verify the tool is installed and its bin directory is in your system PATH.",
    },
  },
];
