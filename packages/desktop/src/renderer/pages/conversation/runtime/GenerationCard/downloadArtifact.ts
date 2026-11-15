/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Last path segment of a Windows or POSIX path. */
export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/**
 * Saves an artifact served by the local media service. Reads the bytes and triggers a save,
 * because an anchor download attribute is ignored for cross-origin URLs.
 */
export async function downloadArtifact(url: string, fileName: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Artifact download failed (${response.status})`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error('Artifact data is empty');
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
}
