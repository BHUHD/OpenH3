export type H3SetupPhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'installing-acceleration'
  | 'installed'
  | 'paused'
  | 'failed';
export type H3DownloadProgress = {
  filename: string;
  sourceHost?: string;
  bytes: number;
  totalBytes: number;
  retryAttempt?: number;
  retryDelayMs?: number;
};
export type H3SetupState = {
  phase: H3SetupPhase;
  bundleRoot?: string;
  error?: string;
  updatedAt?: string;
  download?: boolean;
} & Partial<H3DownloadProgress>;
export type H3SetupPlan = {
  freeBytes: number;
  requiredBytes: number;
  downloadBytes: number;
  reserveBytes: number;
  enough: boolean;
};
export type H3HardwareAssessment = {
  status: 'blocked' | 'unverified' | 'baseline-match';
  reasons: string[];
  generationVerified: false;
  gpuNames: string[];
  memoryGiB: number;
  driver: string | null;
};
