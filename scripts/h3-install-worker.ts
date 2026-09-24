import { parentPort, workerData } from 'node:worker_threads';
import { H3PortableInstaller } from '../packages/desktop/src/process/services/runtime/H3PortableInstaller';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  buildH3DownloadPlan,
  inspectH3DownloadSpace,
} from '../packages/desktop/src/process/services/runtime/h3DownloadPlan';
import { downloadH3FromSources } from '../packages/desktop/src/process/services/runtime/h3Downloader';
import { prepareH3Acceleration } from '../packages/desktop/src/process/services/runtime/h3Acceleration';
const controller = new AbortController();
parentPort?.on('message', (message) => {
  if (message?.pause === true) controller.abort();
});
async function main() {
  if (workerData.download) {
    if (!inspectH3DownloadSpace(workerData.bundleRoot).enough) throw new Error('H3_DISK_SPACE_INSUFFICIENT');
    parentPort?.postMessage({ phase: 'downloading' });
    const sourceFile = path.join(workerData.bundleRoot, 'download-sources.json');
    const config = fs.existsSync(sourceFile)
      ? JSON.parse(fs.readFileSync(sourceFile, 'utf8').replace(/^\uFEFF/, ''))
      : {};
    if (
      !config ||
      typeof config !== 'object' ||
      (config.baseUrls !== undefined &&
        (!Array.isArray(config.baseUrls) || config.baseUrls.some((url: unknown) => typeof url !== 'string'))) ||
      (config.publicSources !== undefined && typeof config.publicSources !== 'boolean')
    )
      throw new Error('H3_DOWNLOAD_SOURCE_CONFIG_INVALID');
    for (const file of buildH3DownloadPlan(config).files) {
      controller.signal.throwIfAborted();
      const destination = path.join(workerData.bundleRoot, file.relativePath);
      if (file.embeddedBase64) {
        const bytes = Buffer.from(file.embeddedBase64, 'base64');
        if (bytes.length !== file.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256)
          throw new Error('H3_EMBEDDED_WORKFLOW_INVALID');
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(`${destination}.part`, bytes);
        fs.renameSync(`${destination}.part`, destination);
      } else {
        let lastReport = 0;
        let lastBytes = fs.existsSync(`${destination}.part`) ? fs.statSync(`${destination}.part`).size : 0;
        parentPort?.postMessage({
          phase: 'downloading',
          detail: {
            filename: file.relativePath,
            bytes: lastBytes,
            totalBytes: file.sizeBytes,
            retryAttempt: 0,
            retryDelayMs: 0,
          },
        });
        await downloadH3FromSources(
          { ...file, url: file.url!, destination },
          {
            signal: controller.signal,
            maxAttempts: 2,
            onSource: (sourceHost) =>
              parentPort?.postMessage({
                phase: 'downloading',
                detail: {
                  filename: file.relativePath,
                  bytes: lastBytes,
                  totalBytes: file.sizeBytes,
                  sourceHost,
                  retryAttempt: 0,
                  retryDelayMs: 0,
                },
              }),
            retryDelayMs: 2000,
            onRetry: (retryAttempt, retryDelayMs) =>
              parentPort?.postMessage({
                phase: 'downloading',
                detail: {
                  filename: file.relativePath,
                  bytes: lastBytes,
                  totalBytes: file.sizeBytes,
                  retryAttempt,
                  retryDelayMs,
                },
              }),
            onProgress: (bytes) => {
              lastBytes = bytes;
              if (Date.now() - lastReport < 500 && bytes !== file.sizeBytes) return;
              lastReport = Date.now();
              parentPort?.postMessage({
                phase: 'downloading',
                detail: {
                  filename: file.relativePath,
                  bytes,
                  totalBytes: file.sizeBytes,
                  retryAttempt: 0,
                  retryDelayMs: 0,
                },
              });
            },
          }
        );
      }
    }
  }
  controller.signal.throwIfAborted();
  new H3PortableInstaller({
    bundleRoot: workerData.bundleRoot,
    onPhase: (phase) => parentPort?.postMessage({ phase }),
  }).ensureInstalled();
  if (workerData.download) await installAcceleration(workerData.bundleRoot);
  parentPort?.postMessage({ done: true });
}

async function installAcceleration(bundleRoot: string): Promise<void> {
  parentPort?.postMessage({ phase: 'installing-acceleration' });
  await prepareH3Acceleration(bundleRoot, path.join(bundleRoot, 'runtime', 'ComfyUI_windows_portable'), {
    signal: controller.signal,
    retry: true,
    onProgress: (detail) => parentPort?.postMessage({ phase: 'installing-acceleration', detail }),
  });
}
void main()
  .catch((error: unknown) => {
    parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(() => parentPort?.close());
