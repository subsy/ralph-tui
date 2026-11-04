/**
 * ABOUTME: Parses acceptance criteria for executable assertions.
 * Extracts shell commands and file existence checks
 * from human-readable acceptance criteria strings.
 */

export interface ExecutableAC {
  original: string;
  type: 'command' | 'file-exists' | 'file-contains';
  assertion: string;
}

/**
 * Parse acceptance criteria strings for executable assertions.
 * Returns only the criteria that can be automatically validated.
 *
 * Patterns detected:
 * - Shell commands: strings containing backtick-wrapped commands or starting with "Running"
 * - File existence: "file 'X' exists", "path.txt is created", "Tests exist in X"
 */
export function parseExecutableCriteria(criteria: string[]): ExecutableAC[] {
  const results: ExecutableAC[] = [];

  for (const criterion of criteria) {
    const cmdMatch = criterion.match(/[`']([^`']+)[`']/);
    // Detect file/directory existence: "Tests exist in src/__tests__/"
    const locationMatch = criterion.match(
      /\b(?:exists?|created|present)\s+(?:in|at)\s+(?:'([^']+)'|"([^"]+)"|`([^`]+)`|([^\s'"`]+))/i
    );
    const existsMatch = locationMatch ?? criterion.match(
      /(?:'([^']+)'|"([^"]+)"|`([^`]+)`|([^\s'"`]+))\s+(?:exists?|is\s+(?:created|present))\b/i
    );
    // A literal file assertion takes precedence over command-looking filenames.
    if (existsMatch && (!cmdMatch || !looksLikeCommand(cmdMatch[1]) ||
        (existsMatch.index ?? 0) <= (cmdMatch.index ?? 0))) {
      const rawPath = existsMatch[1] ?? existsMatch[2] ?? existsMatch[3] ?? existsMatch[4];
      const path = existsMatch[4] !== undefined ? rawPath.replace(/[.,;:!?)\]]+$/, '') : rawPath;
      const explicitFileLocation = locationMatch && /\b(?:files?|paths?|director(?:y|ies))\b/i.test(
        criterion.slice(0, locationMatch.index),
      );
      if (!path || (existsMatch[4] !== undefined && !/[./\\_-]/.test(path) && !explicitFileLocation)) continue;
      const quote = existsMatch[1] !== undefined ? "'" : existsMatch[2] !== undefined ? '"' : existsMatch[3] !== undefined ? '`' : undefined;
      const matchStart = existsMatch.index ?? 0;
      const existenceProse = quote
        ? criterion.slice(0, matchStart) + existsMatch[0].replace(`${quote}${path}${quote}`, '') +
          criterion.slice(matchStart + existsMatch[0].length)
        : criterion;
      if (/\b(?:no|none|neither|nor|not|never|without|cannot)\b|\b\w+n['’]t\b/i.test(existenceProse)) continue;
      results.push({
        original: criterion,
        type: 'file-exists',
        assertion: path,
      });
      continue;
    }

    // Detect shell commands in backticks: "Running `bun test` passes"
    if (cmdMatch && looksLikeCommand(cmdMatch[1])) {
      results.push({
        original: criterion,
        type: 'command',
        assertion: cmdMatch[1],
      });
      continue;
    }

    // Skip non-executable criteria silently
  }

  return results;
}

function looksLikeCommand(s: string): boolean {
  const cmdPrefixes = ['bun ', 'npm ', 'npx ', 'node ', 'git ', 'curl ', 'test '];
  return cmdPrefixes.some(p => s.startsWith(p)) || s.includes(' run ');
}

/** Escape a string for safe use inside single-quoted shell arguments. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

/** Shell metacharacters that could enable command injection. */
const SHELL_METACHAR_RE = /[;&|><`$\\{}()!\n\r\0]/;

/**
 * Convert executable AC into verification commands.
 */
export function acToVerificationCommands(acs: ExecutableAC[], allowCommands = false): string[] {
  return acs.map(ac => {
    switch (ac.type) {
      case 'command':
        // Reject commands containing shell metacharacters to prevent injection.
        // Acceptance criteria come from user-authored task files but may be
        // processed by AI agents. This rejects shell syntax, not unsafe programs.
        if (allowCommands !== true || SHELL_METACHAR_RE.test(ac.assertion)) return '';
        return ac.assertion;
      case 'file-exists':
        return `test -e '${shellEscape(ac.assertion)}'`;
      case 'file-contains':
        return '';
      default:
        return '';
    }
  }).filter(Boolean);
}

/**
 * Extract acceptance criteria from a task's metadata and convert to
 * verification commands. Returns an empty array if no executable AC found.
 */
export function getAcVerificationCommands(
  taskMetadata?: Record<string, unknown>,
  allowCommands = false,
): string[] {
  if (!taskMetadata) return [];

  const ac = taskMetadata['acceptanceCriteria'];
  if (!Array.isArray(ac)) return [];

  const criteria = ac.filter((item): item is string => typeof item === 'string');
  const executable = parseExecutableCriteria(criteria);
  return acToVerificationCommands(executable, allowCommands);
}

/** Keep literal file checks out of the configured shell's command language. */
export function getAcVerificationChecks(
  taskMetadata?: Record<string, unknown>,
  allowCommands = false,
): { files: string[]; commands: string[] } {
  const criteria = taskMetadata?.acceptanceCriteria;
  const executable = parseExecutableCriteria(
    Array.isArray(criteria) ? criteria.filter((item): item is string => typeof item === 'string') : [],
  );
  return {
    files: executable.filter(ac => ac.type === 'file-exists').map(ac => ac.assertion),
    commands: acToVerificationCommands(executable.filter(ac => ac.type === 'command'), allowCommands),
  };
}
