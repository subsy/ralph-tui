/** ABOUTME: Tests for interrupt-handler startup fallback behavior. */

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createInterruptHandler } from '../../src/interruption/handler.js';
import type { InterruptHandler } from '../../src/interruption/types.js';

describe('createInterruptHandler', () => {
  let handler: InterruptHandler | undefined;

  afterEach(() => {
    handler?.dispose();
    handler = undefined;
  });

  test('resets after an interrupt when the TUI cannot show a dialog yet', () => {
    const shutdown = mock(() => {});
    const forceQuit = mock(() => {});
    const showDialog = mock(() => {
      handler?.reset();
      shutdown();
    });

    handler = createInterruptHandler({
      onShowDialog: showDialog,
      onHideDialog: () => {},
      onConfirmed: async () => {},
      onCancelled: () => {},
      onForceQuit: forceQuit,
    });

    handler.handleSigint();

    expect(showDialog).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(handler.getState()).toBe('idle');

    handler.handleSigint();

    expect(showDialog).toHaveBeenCalledTimes(2);
    expect(shutdown).toHaveBeenCalledTimes(2);
    expect(forceQuit).not.toHaveBeenCalled();
    expect(handler.getState()).toBe('idle');
  });
});
