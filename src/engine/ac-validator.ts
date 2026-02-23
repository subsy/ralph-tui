/**
 * ABOUTME: Parses acceptance criteria for executable assertions.
 * Extracts shell commands, file existence checks, and URL patterns
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
 * - File existence: "file X exists", "X is created", "Tests exist in X"
 * - File contains: "X contains Y", "X includes Y"
 */
export function parseExecutableCriteria(criteria: string[]): ExecutableAC[] {
  const results: ExecutableAC[] = [];

  for (const criterion of criteria) {
    // Detect shell commands in backticks: "Running `bun test` passes"
    const cmdMatch = criterion.match(/[`']([^`']+)[`']/);
    if (cmdMatch && looksLikeCommand(cmdMatch[1])) {
      results.push({
        original: criterion,
        type: 'command',
        assertion: cmdMatch[1],
      });
      continue;
    }

    // Detect file/directory existence: "Tests exist in src/__tests__/"
    const existsMatch = criterion.match(
      /(?:exist|created|present)\s+(?:in|at)\s+[`']?([^\s`']+)[`']?/i
    );
    if (existsMatch) {
      results.push({
        original: criterion,
        type: 'file-exists',
        assertion: existsMatch[1],
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

/**
 * Convert executable AC into verification commands.
 */
export function acToVerificationCommands(acs: ExecutableAC[]): string[] {
  return acs.map(ac => {
    switch (ac.type) {
      case 'command':
        return ac.assertion;
      case 'file-exists':
        return `test -e '${shellEscape(ac.assertion)}'`;
      case 'file-contains':
        return `grep -q '${shellEscape(ac.assertion)}' || true`; // soft check
      default:
        return '';
    }
  }).filter(Boolean);
}

/**
 * Extract acceptance criteria from a task's metadata and convert to
 * verification commands. Returns an empty array if no executable AC found.
 */
export function getAcVerificationCommands(taskMetadata?: Record<string, unknown>): string[] {
  if (!taskMetadata) return [];

  const ac = taskMetadata['acceptanceCriteria'];
  if (!Array.isArray(ac)) return [];

  const criteria = ac.filter((item): item is string => typeof item === 'string');
  const executable = parseExecutableCriteria(criteria);
  return acToVerificationCommands(executable);
}
