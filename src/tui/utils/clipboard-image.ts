/**
 * ABOUTME: Cross-platform clipboard image reading utility for ralph-tui.
 * Provides image extraction from system clipboard across macOS, Linux, and Windows.
 * Returns PNG buffer data or null if no image is present.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

/** Default timeout for clipboard operations in milliseconds */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Result of a clipboard image read operation.
 */
export interface ClipboardImageResult {
  /** PNG image data as a Buffer, or null if no image in clipboard */
  data: Buffer | null;
  /** Error message if the operation failed */
  error?: string;
  /** Installation hint if the required tool is not installed */
  installHint?: string;
}

/**
 * Information about available clipboard tools on the system.
 */
export interface ClipboardToolInfo {
  /** Whether any clipboard tool is available */
  available: boolean;
  /** Name of the available tool, if any */
  toolName?: string;
  /** Installation hint if no tool is available */
  installHint?: string;
}

/**
 * Check if a command exists on the system.
 *
 * @param command - The command to check
 * @returns Promise resolving to true if the command exists
 */
async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checkCmd = platform() === 'win32' ? 'where' : 'which';
    const proc = spawn(checkCmd, [command], { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Execute a command and return its stdout as a Buffer.
 *
 * @param command - The command to execute
 * @param args - Command arguments
 * @param timeoutMs - Timeout in milliseconds
 * @returns Promise resolving to stdout Buffer or null if command fails
 */
async function execCommand(
  command: string,
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: Buffer | null; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let stderrOutput = '';

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ stdout: null, stderr: 'Operation timed out', exitCode: null });
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      const stdout = chunks.length > 0 ? Buffer.concat(chunks) : null;
      resolve({ stdout, stderr: stderrOutput, exitCode: code });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ stdout: null, stderr: err.message, exitCode: null });
    });
  });
}

/**
 * Get installation hints for clipboard tools based on platform.
 */
function getInstallHints(): Record<string, string> {
  const os = platform();

  switch (os) {
    case 'darwin':
      return {
        pngpaste: 'Install pngpaste: brew install pngpaste',
        osascript: 'osascript is built-in on macOS',
      };

    case 'linux':
      return {
        xclip:
          'Install xclip: sudo apt install xclip (Debian/Ubuntu) or sudo pacman -S xclip (Arch)',
        'wl-paste':
          'Install wl-clipboard: sudo apt install wl-clipboard (Debian/Ubuntu) or sudo pacman -S wl-clipboard (Arch)',
      };

    case 'win32':
      return {
        powershell: 'PowerShell is built-in on Windows',
      };

    default:
      return {};
  }
}

/**
 * Check which clipboard image tool is available on the current platform.
 *
 * @returns Promise resolving to information about available tools
 */
export async function checkClipboardTool(): Promise<ClipboardToolInfo> {
  const os = platform();
  const hints = getInstallHints();

  switch (os) {
    case 'darwin': {
      // Check for pngpaste first (preferred)
      if (await commandExists('pngpaste')) {
        return { available: true, toolName: 'pngpaste' };
      }
      // osascript is always available on macOS
      return { available: true, toolName: 'osascript' };
    }

    case 'linux': {
      // Check for Wayland first (wl-paste), then X11 tools
      if (await commandExists('wl-paste')) {
        return { available: true, toolName: 'wl-paste' };
      }
      if (await commandExists('xclip')) {
        return { available: true, toolName: 'xclip' };
      }
      return {
        available: false,
        installHint: `No clipboard tool found. ${hints['xclip']} or ${hints['wl-paste']}`,
      };
    }

    case 'win32': {
      // PowerShell is always available on modern Windows
      return { available: true, toolName: 'powershell' };
    }

    default:
      return {
        available: false,
        installHint: `Unsupported platform: ${os}`,
      };
  }
}

/**
 * Check if the clipboard contains image data (vs text or other content).
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to true if clipboard contains an image
 */
export async function hasClipboardImage(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  const os = platform();

  switch (os) {
    case 'darwin': {
      // Use osascript to check clipboard class
      const script = `
        try
          set theClipboard to the clipboard as «class PNGf»
          return "image"
        on error
          try
            set theClipboard to the clipboard as TIFF picture
            return "image"
          on error
            return "none"
          end try
        end try
      `;
      const result = await execCommand('osascript', ['-e', script], timeoutMs);
      return result.stdout?.toString().trim() === 'image';
    }

    case 'linux': {
      // Check clipboard targets for image types
      if (await commandExists('wl-paste')) {
        const result = await execCommand(
          'wl-paste',
          ['--list-types'],
          timeoutMs,
        );
        const types = result.stdout?.toString() ?? '';
        return types.includes('image/png') || types.includes('image/');
      }
      if (await commandExists('xclip')) {
        const result = await execCommand(
          'xclip',
          ['-selection', 'clipboard', '-t', 'TARGETS', '-o'],
          timeoutMs,
        );
        const targets = result.stdout?.toString() ?? '';
        return targets.includes('image/png') || targets.includes('image/');
      }
      return false;
    }

    case 'win32': {
      // Use PowerShell to check if clipboard contains an image
      const script = `
        Add-Type -AssemblyName System.Windows.Forms
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        if ($img -ne $null) { Write-Output "image" } else { Write-Output "none" }
      `;
      const result = await execCommand(
        'powershell',
        ['-NoProfile', '-Command', script],
        timeoutMs,
      );
      return result.stdout?.toString().trim() === 'image';
    }

    default:
      return false;
  }
}

/**
 * Read image data from macOS clipboard using pngpaste.
 */
async function readMacOSWithPngpaste(
  timeoutMs: number,
): Promise<ClipboardImageResult> {
  // pngpaste outputs to stdout when using '-' as filename
  const result = await execCommand('pngpaste', ['-'], timeoutMs);

  if (result.exitCode === 0 && result.stdout && result.stdout.length > 0) {
    return { data: result.stdout };
  }

  // Exit code 1 typically means no image in clipboard
  if (result.exitCode === 1) {
    return { data: null };
  }

  return {
    data: null,
    error: result.stderr || 'pngpaste failed to read clipboard',
  };
}

/**
 * Read image data from macOS clipboard using osascript (fallback).
 */
async function readMacOSWithOsascript(
  timeoutMs: number,
): Promise<ClipboardImageResult> {
  // osascript doesn't easily output binary, so we write to a temp file
  const tempFile = join(tmpdir(), `clipboard-${randomUUID()}.png`);

  try {
    // AppleScript to save clipboard image to file
    const script = `
      try
        set theImage to the clipboard as «class PNGf»
        set theFile to open for access POSIX file "${tempFile}" with write permission
        write theImage to theFile
        close access theFile
        return "success"
      on error errMsg
        try
          close access theFile
        end try
        return "error: " & errMsg
      end try
    `;

    const result = await execCommand('osascript', ['-e', script], timeoutMs);
    const output = result.stdout?.toString().trim() ?? '';

    if (output === 'success') {
      const data = await readFile(tempFile);
      return { data };
    }

    // Check if error indicates no image
    if (
      output.includes("Can't get the clipboard") ||
      output.includes('-1700')
    ) {
      return { data: null };
    }

    return {
      data: null,
      error: output.replace('error: ', ''),
    };
  } finally {
    // Clean up temp file
    try {
      await unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Read image data from Linux clipboard using xclip.
 */
async function readLinuxWithXclip(
  timeoutMs: number,
): Promise<ClipboardImageResult> {
  const result = await execCommand(
    'xclip',
    ['-selection', 'clipboard', '-t', 'image/png', '-o'],
    timeoutMs,
  );

  if (result.exitCode === 0 && result.stdout && result.stdout.length > 0) {
    return { data: result.stdout };
  }

  // Check if no image in clipboard
  if (result.stderr.includes('Error: target image/png not available')) {
    return { data: null };
  }

  return {
    data: null,
    error: result.stderr || 'xclip failed to read clipboard',
  };
}

/**
 * Read image data from Linux clipboard using wl-paste (Wayland).
 */
async function readLinuxWithWlPaste(
  timeoutMs: number,
): Promise<ClipboardImageResult> {
  const result = await execCommand(
    'wl-paste',
    ['--type', 'image/png'],
    timeoutMs,
  );

  if (result.exitCode === 0 && result.stdout && result.stdout.length > 0) {
    return { data: result.stdout };
  }

  // Check if no image in clipboard
  if (result.stderr.includes('No suitable type') || result.exitCode === 1) {
    return { data: null };
  }

  return {
    data: null,
    error: result.stderr || 'wl-paste failed to read clipboard',
  };
}

/**
 * Read image data from Windows clipboard using PowerShell.
 */
async function readWindowsClipboard(
  timeoutMs: number,
): Promise<ClipboardImageResult> {
  // Write to temp file since PowerShell binary output is complex
  const tempFile = join(tmpdir(), `clipboard-${randomUUID()}.png`);

  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $img = [System.Windows.Forms.Clipboard]::GetImage()
      if ($img -eq $null) {
        Write-Output "no-image"
        exit 0
      }
      $img.Save("${tempFile.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "success"
    `;

    const result = await execCommand(
      'powershell',
      ['-NoProfile', '-Command', script],
      timeoutMs,
    );

    const output = result.stdout?.toString().trim() ?? '';

    if (output === 'success') {
      const data = await readFile(tempFile);
      return { data };
    }

    if (output === 'no-image') {
      return { data: null };
    }

    return {
      data: null,
      error: result.stderr || 'PowerShell failed to read clipboard',
    };
  } finally {
    // Clean up temp file
    try {
      await unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Read image data from the system clipboard.
 *
 * This function detects the current platform and uses the appropriate
 * tool to read image data from the clipboard. Returns null if no image
 * is present in the clipboard.
 *
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to the clipboard image result
 *
 * @example
 * ```typescript
 * const result = await readClipboardImage();
 * if (result.data) {
 *   // Use result.data as PNG Buffer
 *   await writeFile('screenshot.png', result.data);
 * } else if (result.error) {
 *   console.error('Failed to read clipboard:', result.error);
 *   if (result.installHint) {
 *     console.log(result.installHint);
 *   }
 * } else {
 *   console.log('No image in clipboard');
 * }
 * ```
 */
export async function readClipboardImage(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ClipboardImageResult> {
  const os = platform();
  const hints = getInstallHints();

  switch (os) {
    case 'darwin': {
      // Try pngpaste first (faster, more reliable)
      if (await commandExists('pngpaste')) {
        return readMacOSWithPngpaste(timeoutMs);
      }
      // Fall back to osascript (always available)
      return readMacOSWithOsascript(timeoutMs);
    }

    case 'linux': {
      // Try Wayland first
      if (await commandExists('wl-paste')) {
        return readLinuxWithWlPaste(timeoutMs);
      }
      // Try X11 tools
      if (await commandExists('xclip')) {
        return readLinuxWithXclip(timeoutMs);
      }
      // No tool available
      return {
        data: null,
        error: 'No clipboard tool available',
        installHint: `${hints['xclip']} or ${hints['wl-paste']}`,
      };
    }

    case 'win32': {
      return readWindowsClipboard(timeoutMs);
    }

    default:
      return {
        data: null,
        error: `Unsupported platform: ${os}`,
      };
  }
}
