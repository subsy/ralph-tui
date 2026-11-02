/** ABOUTME: Platform-aware classification for copy and Ctrl+C keyboard shortcuts. */

export interface ShortcutKey {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  option?: boolean;
}

export type CtrlCAction = 'copy' | 'interrupt' | 'none';

/**
 * Classify copy and interrupt shortcuts across terminal platforms.
 *
 * macOS uses Cmd+C to copy. Linux uses Alt+C; Ctrl+Shift+C is also recognized
 * in terminals that report Shift, such as kitty and ghostty. Konsole and
 * gnome-terminal send Ctrl+Shift+C as plain 0x03, indistinguishable from
 * Ctrl+C, so it requests an interrupt there. Windows uses Ctrl+C to copy only
 * when text is selected. Plain Ctrl+C otherwise requests an interrupt.
 */
export function classifyCopyOrInterrupt(
  key: ShortcutKey,
  options: { platform: NodeJS.Platform; hasSelection: boolean }
): CtrlCAction {
  const isMac = options.platform === 'darwin';
  const isWindows = options.platform === 'win32';
  const isC = key.name === 'c';
  const isCopyShortcut = isMac
    ? Boolean(key.meta) && isC
    : isWindows
      ? Boolean(key.ctrl) && isC
      : (Boolean(key.ctrl) && Boolean(key.shift) && isC) || (Boolean(key.option) && isC);

  if (isCopyShortcut && options.hasSelection) {
    return 'copy';
  }
  if (isC && Boolean(key.ctrl) && !key.shift && !key.option) {
    return 'interrupt';
  }
  return 'none';
}
