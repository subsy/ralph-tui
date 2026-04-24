/**
 * ABOUTME: Overlay component for managing remote instances (add, edit, delete).
 * Provides a unified form for adding new remotes or editing existing ones,
 * and a confirmation dialog for deletions.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { colors } from '../theme.js';
import { buildRemoteWebSocketUrl } from '../../remote/url.js';

/**
 * Mode determines which UI to show
 */
export type RemoteManagementMode = 'add' | 'edit' | 'delete';

/**
 * Data for an existing remote (for edit/delete modes)
 */
export interface ExistingRemoteData {
  alias: string;
  host: string;
  port: number;
  secure?: boolean;
  token: string;
}

/**
 * Props for the RemoteManagementOverlay component
 */
export interface RemoteManagementOverlayProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** Current mode: add, edit, or delete */
  mode: RemoteManagementMode;
  /** Existing remote data for edit/delete modes */
  existingRemote?: ExistingRemoteData;
  /** Callback when saving (add or edit) */
  onSave: (data: { alias: string; host: string; port: number; secure: boolean; token: string }) => Promise<void>;
  /** Callback when deleting */
  onDelete: (alias: string) => Promise<void>;
  /** Callback when closing the overlay */
  onClose: () => void;
}

/**
 * Form field indices for keyboard navigation
 */
const FIELD_ALIAS = 0;
const FIELD_HOST = 1;
const FIELD_PORT = 2;
const FIELD_SECURE = 3;
const FIELD_TOKEN = 4;
const FIELD_COUNT = 5;

/**
 * Validate alias format
 */
function validateAlias(alias: string): string | null {
  if (!alias.trim()) {
    return 'Alias is required';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) {
    return 'Alias must start with a letter and contain only letters, numbers, dashes, and underscores';
  }
  return null;
}

/**
 * Validate host
 */
function validateHost(host: string): string | null {
  if (!host.trim()) {
    return 'Host is required';
  }
  return null;
}

/**
 * Validate port
 */
function validatePort(portStr: string): string | null {
  if (!portStr.trim()) {
    return 'Port is required';
  }
  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    return 'Port must be a number between 1 and 65535';
  }
  return null;
}

/**
 * Validate token
 */
function validateToken(token: string): string | null {
  if (!token.trim()) {
    return 'Token is required';
  }
  return null;
}

/**
 * RemoteManagementOverlay - handles add, edit, delete operations for remotes
 */
export function RemoteManagementOverlay({
  visible,
  mode,
  existingRemote,
  onSave,
  onDelete,
  onClose,
}: RemoteManagementOverlayProps): ReactNode {
  // Form state
  const [alias, setAlias] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7890');
  const [secure, setSecure] = useState(false);
  const [token, setToken] = useState('');

  // UI state
  const [focusedField, setFocusedField] = useState(FIELD_ALIAS);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset form state when opening
  useEffect(() => {
    if (visible) {
      if (mode === 'add') {
        setAlias('');
        setHost('');
        setPort('7890');
        setSecure(false);
        setToken('');
        setFocusedField(FIELD_ALIAS);
      } else if (existingRemote) {
        setAlias(existingRemote.alias);
        setHost(existingRemote.host);
        setPort(String(existingRemote.port));
        setSecure(existingRemote.secure ?? existingRemote.port === 443);
        setToken(existingRemote.token);
        setFocusedField(FIELD_ALIAS);
      }
      setShowToken(false);
      setError(null);
      setSaving(false);
    }
  }, [visible, mode, existingRemote]);

  // Handle form submission
  const handleSubmit = useCallback(async () => {
    // Validate all fields
    const aliasError = validateAlias(alias);
    if (aliasError) {
      setError(aliasError);
      setFocusedField(FIELD_ALIAS);
      return;
    }

    const hostError = validateHost(host);
    if (hostError) {
      setError(hostError);
      setFocusedField(FIELD_HOST);
      return;
    }

    const portError = validatePort(port);
    if (portError) {
      setError(portError);
      setFocusedField(FIELD_PORT);
      return;
    }

    const tokenError = validateToken(token);
    if (tokenError) {
      setError(tokenError);
      setFocusedField(FIELD_TOKEN);
      return;
    }

    setError(null);
    setSaving(true);

    try {
      await onSave({
        alias: alias.trim(),
        host: host.trim(),
        port: parseInt(port, 10),
        secure,
        token: token.trim(),
      });
      // onClose will be called by parent after successful save
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save remote');
      setSaving(false);
    }
  }, [alias, host, port, secure, token, onSave]);

  // Handle delete confirmation
  const handleDelete = useCallback(async () => {
    if (!existingRemote) return;

    setSaving(true);
    try {
      await onDelete(existingRemote.alias);
      // onClose will be called by parent after successful delete
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete remote');
      setSaving(false);
    }
  }, [existingRemote, onDelete]);

  // Update the currently focused field's value
  const updateCurrentField = useCallback((updater: (prev: string) => string) => {
    switch (focusedField) {
      case FIELD_ALIAS:
        setAlias(updater);
        break;
      case FIELD_HOST:
        setHost(updater);
        break;
      case FIELD_PORT:
        setPort(updater);
        break;
      case FIELD_TOKEN:
        setToken(updater);
        break;
    }
  }, [focusedField]);

  // Handle keyboard input
  useKeyboard(
    useCallback(
      (key) => {
        if (!visible) return;

        // Clear error on any key press
        setError(null);

        // Delete confirmation mode has different keyboard handling
        if (mode === 'delete') {
          switch (key.name) {
            case 'y':
              handleDelete();
              break;
            case 'n':
            case 'escape':
              onClose();
              break;
          }
          return;
        }

        // Form mode (add/edit)
        switch (key.name) {
          case 'tab':
            // Navigate between fields
            if (key.shift) {
              setFocusedField((prev) => (prev - 1 + FIELD_COUNT) % FIELD_COUNT);
            } else {
              setFocusedField((prev) => (prev + 1) % FIELD_COUNT);
            }
            break;

          case 'return':
          case 'enter':
            handleSubmit();
            break;

          case 'escape':
            onClose();
            break;

          case 'backspace':
            updateCurrentField((prev) => prev.slice(0, -1));
            break;

          case 'space':
            if (focusedField === FIELD_SECURE) {
              setSecure((prev) => !prev);
            }
            break;

          default:
            // Toggle token visibility with '*'
            if (key.sequence === '*') {
              setShowToken((prev) => !prev);
              break;
            }

            // Append printable characters to current field
            if (key.sequence && key.sequence.length === 1) {
              // Only allow digits for port field
              if (focusedField === FIELD_SECURE) {
                const lowerSequence = key.sequence.toLowerCase();
                if (lowerSequence === 'y' || lowerSequence === 't') {
                  setSecure(true);
                } else if (lowerSequence === 'n' || lowerSequence === 'f') {
                  setSecure(false);
                }
              } else if (focusedField === FIELD_PORT) {
                if (/^\d$/.test(key.sequence)) {
                  updateCurrentField((prev) => prev + key.sequence);
                }
              } else {
                updateCurrentField((prev) => prev + key.sequence);
              }
            }
            break;
        }
      },
      [visible, mode, focusedField, handleSubmit, handleDelete, onClose, updateCurrentField]
    )
  );

  if (!visible) return null;

  // Delete confirmation UI
  if (mode === 'delete' && existingRemote) {
    return (
      <box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#000000B3',
        }}
      >
        <box
          style={{
            flexDirection: 'column',
            padding: 2,
            backgroundColor: colors.bg.secondary,
            borderColor: colors.status.error,
            minWidth: 50,
            maxWidth: 60,
          }}
          border
        >
          {/* Header */}
          <box style={{ marginBottom: 1, justifyContent: 'center' }}>
            <text fg={colors.status.error}>Delete Remote</text>
          </box>

          {/* Confirmation message */}
          <box style={{ marginBottom: 1 }}>
            <text fg={colors.fg.primary}>
              Are you sure you want to delete
            </text>
          </box>
          <box style={{ marginBottom: 1, justifyContent: 'center' }}>
            <text fg={colors.accent.primary}>"{existingRemote.alias}"</text>
            <text fg={colors.fg.primary}>?</text>
          </box>

          {/* Remote details */}
          <box style={{ marginBottom: 1 }}>
            <text fg={colors.fg.muted}>
              URL: {buildRemoteWebSocketUrl(existingRemote.host, existingRemote.port, existingRemote.secure)}
            </text>
          </box>

          {/* Error message */}
          {error && (
            <box style={{ marginBottom: 1 }}>
              <text fg={colors.status.error}>{error}</text>
            </box>
          )}

          {/* Footer */}
          <box style={{ marginTop: 1, justifyContent: 'center' }}>
            <text fg={colors.fg.muted}>
              {saving ? 'Deleting...' : '[y] Yes, delete    [n/Esc] Cancel'}
            </text>
          </box>
        </box>
      </box>
    );
  }

  // Add/Edit form UI
  const title = mode === 'add' ? 'Add Remote' : 'Edit Remote';

  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000000B3',
      }}
    >
      <box
        style={{
          flexDirection: 'column',
          padding: 2,
          backgroundColor: colors.bg.secondary,
          borderColor: colors.accent.primary,
          minWidth: 50,
          maxWidth: 60,
        }}
        border
      >
        {/* Header */}
        <box style={{ marginBottom: 1, justifyContent: 'center' }}>
          <text fg={colors.accent.primary}>{title}</text>
        </box>

        {/* Form fields */}
        <FormField
          label="Alias"
          value={alias}
          focused={focusedField === FIELD_ALIAS}
        />
        <FormField
          label="Host"
          value={host}
          focused={focusedField === FIELD_HOST}
        />
        <FormField
          label="Port"
          value={port}
          focused={focusedField === FIELD_PORT}
        />
        <FormField
          label="Secure"
          value={secure ? 'yes' : 'no'}
          focused={focusedField === FIELD_SECURE}
        />
        <FormField
          label="Token"
          value={showToken ? token : '*'.repeat(token.length || 8)}
          focused={focusedField === FIELD_TOKEN}
        />

        {/* Token visibility hint */}
        <box style={{ paddingLeft: 10, marginBottom: 1 }}>
          <text fg={colors.fg.muted}>
            Press * to {showToken ? 'hide' : 'show'} token, Space to toggle secure
          </text>
        </box>

        {/* Error message */}
        {error && (
          <box style={{ marginTop: 1, justifyContent: 'center' }}>
            <text fg={colors.status.error}>{error}</text>
          </box>
        )}

        {/* Footer with hints */}
        <box style={{ marginTop: 1, justifyContent: 'center' }}>
          <text fg={colors.fg.muted}>
            {saving
              ? 'Saving...'
              : '[Tab] Next field  [Enter] Save  [Esc] Cancel'}
          </text>
        </box>
      </box>
    </box>
  );
}

/**
 * Form field component for consistent field rendering
 */
interface FormFieldProps {
  label: string;
  value: string;
  focused: boolean;
  disabled?: boolean;
}

function FormField({ label, value, focused, disabled }: FormFieldProps): ReactNode {
  const labelWidth = 8;
  const fieldBg = focused ? colors.bg.tertiary : colors.bg.primary;
  const fieldFg = disabled
    ? colors.fg.muted
    : focused
      ? colors.fg.primary
      : colors.fg.secondary;

  return (
    <box style={{ flexDirection: 'row', marginBottom: 1 }}>
      <box style={{ width: labelWidth }}>
        <text fg={focused ? colors.accent.primary : colors.fg.secondary}>
          {label}:
        </text>
      </box>
      <box
        style={{
          flexGrow: 1,
          backgroundColor: fieldBg,
          paddingLeft: 1,
          paddingRight: 1,
          borderColor: focused ? colors.accent.primary : colors.border.muted,
        }}
        border={focused}
      >
        <text fg={fieldFg}>
          {value || (focused ? '' : '(empty)')}
          {focused && !disabled ? '▏' : ''}
        </text>
      </box>
      {disabled && (
        <text fg={colors.fg.muted}> (readonly)</text>
      )}
    </box>
  );
}
