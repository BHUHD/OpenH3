/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BACKEND_BUNDLE_DIR_NAME, LEGACY_BACKEND_BUNDLE_DIR_NAME } from '@/common/config/productIdentity';

type FileStat = {
  mtimeMs: number;
  size: number;
};

type BackendInstallDiagnosticEnv = {
  appVersion?: string;
  arch?: string;
  execPath?: string;
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  readFile?: (filePath: string) => string | undefined;
  resourcesPath?: string;
  stat?: (filePath: string) => FileStat | undefined;
};

export type BackendInstallDiagnostics = {
  appVersion: string;
  arch: string;
  binaryExists?: boolean;
  binaryMtimeMs?: number;
  binaryName?: string;
  binaryPath?: string;
  binarySize?: number;
  bundledDirPath?: string;
  bundledDirName?: string;
  execPath: string;
  isPackaged: boolean;
  manifestExists?: boolean;
  manifestFiles?: string[];
  manifestGeneratedAt?: string;
  manifestMtimeMs?: number;
  manifestParseError?: string;
  manifestPath?: string;
  manifestSize?: number;
  manifestSourceType?: string;
  manifestVersion?: string;
  platform: NodeJS.Platform;
  resourcesDirMtimeMs?: number;
  resourcesPath?: string;
  runtimeDirMtimeMs?: number;
  runtimeDirPath?: string;
  runtimeKey?: string;
};

const MANIFEST_FILE_NAME = 'manifest.json';
const BUNDLED_BACKEND_DIRS = [BACKEND_BUNDLE_DIR_NAME, LEGACY_BACKEND_BUNDLE_DIR_NAME] as const;

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : undefined;
}

function getPathApi(platform: NodeJS.Platform): typeof path.win32 | typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

function defaultStat(filePath: string): FileStat | undefined {
  try {
    const stat = fs.statSync(filePath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return undefined;
  }
}

function defaultReadFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function applyFileStat(
  diagnostics: BackendInstallDiagnostics,
  prefix: 'binary' | 'manifest' | 'resourcesDir' | 'runtimeDir',
  stat: FileStat | undefined
): void {
  if (prefix === 'binary') {
    diagnostics.binaryExists = Boolean(stat);
    if (!stat) return;
    diagnostics.binaryMtimeMs = stat.mtimeMs;
    diagnostics.binarySize = stat.size;
    return;
  }
  if (prefix === 'manifest') {
    diagnostics.manifestExists = Boolean(stat);
    if (!stat) return;
    diagnostics.manifestMtimeMs = stat.mtimeMs;
    diagnostics.manifestSize = stat.size;
    return;
  }
  if (!stat) return;
  if (prefix === 'resourcesDir') {
    diagnostics.resourcesDirMtimeMs = stat.mtimeMs;
    return;
  }
  diagnostics.runtimeDirMtimeMs = stat.mtimeMs;
}

function applyManifest(diagnostics: BackendInstallDiagnostics, manifestText: string | undefined): void {
  if (!manifestText) return;
  try {
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;
    const version = getString(manifest.version);
    const generatedAt = getString(manifest.generatedAt);
    const sourceType = getString(manifest.sourceType);
    const files = getStringArray(manifest.files);
    if (version) diagnostics.manifestVersion = version;
    if (generatedAt) diagnostics.manifestGeneratedAt = generatedAt;
    if (sourceType) diagnostics.manifestSourceType = sourceType;
    if (files) diagnostics.manifestFiles = files;
  } catch (error) {
    diagnostics.manifestParseError = error instanceof Error ? error.message : String(error);
  }
}

export function collectBackendInstallDiagnostics(
  details: Record<string, unknown> | undefined,
  env: BackendInstallDiagnosticEnv = {}
): BackendInstallDiagnostics {
  const platform = env.platform ?? process.platform;
  const pathApi = getPathApi(platform);
  const stat = env.stat ?? defaultStat;
  const readFile = env.readFile ?? defaultReadFile;
  const resourcesPath = getString(details?.resourcesPath) ?? env.resourcesPath;
  const runtimeKey = getString(details?.runtimeKey);
  const binaryName = getString(details?.binaryName);
  const checkedBundledPath = getString(details?.checkedBundledPath);
  // The resolver's actual selected binary is authoritative, including when
  // that binary is missing. A legacy profile need not have the new bundle dir.
  const selectedBundledDirName = BUNDLED_BACKEND_DIRS.find((name) => {
    if (!resourcesPath || !runtimeKey || !checkedBundledPath) return false;
    const expected = pathApi.join(resourcesPath, name, runtimeKey);
    const actual = pathApi.dirname(checkedBundledPath);
    return platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  });
  const reportedBundledDirName = getString(details?.bundledDirName);
  const bundledDirName =
    reportedBundledDirName &&
    BUNDLED_BACKEND_DIRS.includes(reportedBundledDirName as (typeof BUNDLED_BACKEND_DIRS)[number])
      ? reportedBundledDirName
      : (selectedBundledDirName ??
        BUNDLED_BACKEND_DIRS.find((name) => resourcesPath && stat(pathApi.join(resourcesPath, name))) ??
        BACKEND_BUNDLE_DIR_NAME);
  const bundledDirPath = resourcesPath ? pathApi.join(resourcesPath, bundledDirName) : undefined;
  const runtimeDirPath =
    resourcesPath && runtimeKey ? pathApi.join(resourcesPath, bundledDirName, runtimeKey) : undefined;
  const binaryPath =
    checkedBundledPath ?? (runtimeDirPath && binaryName ? pathApi.join(runtimeDirPath, binaryName) : undefined);
  const manifestPath = runtimeDirPath ? pathApi.join(runtimeDirPath, MANIFEST_FILE_NAME) : undefined;

  const diagnostics: BackendInstallDiagnostics = {
    appVersion: env.appVersion ?? 'unknown',
    arch: env.arch ?? process.arch,
    execPath: env.execPath ?? process.execPath,
    isPackaged: env.isPackaged ?? false,
    platform,
  };

  if (resourcesPath) diagnostics.resourcesPath = resourcesPath;
  if (runtimeKey) diagnostics.runtimeKey = runtimeKey;
  if (binaryName) diagnostics.binaryName = binaryName;
  if (bundledDirPath) diagnostics.bundledDirPath = bundledDirPath;
  if (reportedBundledDirName) diagnostics.bundledDirName = bundledDirName;
  if (runtimeDirPath) diagnostics.runtimeDirPath = runtimeDirPath;
  if (binaryPath) diagnostics.binaryPath = binaryPath;
  if (manifestPath) diagnostics.manifestPath = manifestPath;

  if (resourcesPath) applyFileStat(diagnostics, 'resourcesDir', stat(resourcesPath));
  if (runtimeDirPath) applyFileStat(diagnostics, 'runtimeDir', stat(runtimeDirPath));
  if (binaryPath) applyFileStat(diagnostics, 'binary', stat(binaryPath));
  if (manifestPath) {
    applyFileStat(diagnostics, 'manifest', stat(manifestPath));
    applyManifest(diagnostics, readFile(manifestPath));
  }

  return diagnostics;
}
