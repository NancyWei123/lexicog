import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

export async function deliverSingleMessageFromWindowToBackend(
  requestId: string,
  input: string
): Promise<void> {
  return invoke('deliver_single_message_from_window_to_backend', {
    requestId,
    input,
  });
}

export async function deliverCancelSignalFromWindowToBackend(
  taskId: string
): Promise<void> {
  return invoke('deliver_cancel_signal_from_window_to_backend', { taskId });
}

export async function replaceClipboard(text: string): Promise<void> {
  return writeText(text);
}

export async function hideWindow(label: string): Promise<void> {
  return invoke('hide_window', { label });
}
