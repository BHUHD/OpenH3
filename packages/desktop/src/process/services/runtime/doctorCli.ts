import { execFile } from 'node:child_process';
import { freemem, platform, totalmem } from 'node:os';
import { promisify } from 'node:util';
import { collectHardware } from '@process/services/runtime/hardwareProbe';
import { assessH3Readiness, H3_RECIPE } from '@process/services/runtime/h3Assessment';

const execute = promisify(execFile);

async function main(): Promise<void> {
  const hardware = await collectHardware({
    platform: platform(),
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    execute: async (command, args) => {
      const { stdout } = await execute(command, args, {
        encoding: 'utf8',
        timeout: 10000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      return stdout;
    },
  });
  const assessment = assessH3Readiness(hardware);
  console.log(
    JSON.stringify({ schemaVersion: 1, mode: 'read-only', hardware, recipe: H3_RECIPE, assessment }, null, 2)
  );
  // A successful diagnostic is not a successful installation or readiness check.
  process.exitCode = 2;
}

void main().catch(() => {
  console.error(JSON.stringify({ code: 'DOCTOR_FAILED' }));
  process.exitCode = 1;
});
