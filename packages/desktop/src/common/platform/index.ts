import path from 'path';
import type { IPlatformServices } from './IPlatformServices';
import { NodePlatformServices } from './NodePlatformServices';

let _services: IPlatformServices | null = null;

/**
 * Resolve the dev-mode app name for environment isolation.
 * Centralised so that every call-site stays in sync.
 */
export function getDevAppName(): string {
  const isMultiInstance = process.env.AIONUI_MULTI_INSTANCE === '1';
  return isMultiInstance ? 'OpenH3-Dev-2' : 'OpenH3-Dev';
}

export function registerPlatformServices(services: IPlatformServices): void {
  _services = services;
}

export function getPlatformServices(): IPlatformServices {
  if (!_services) {
    // In Electron, module-level code in initStorage.ts may execute before the
    // explicit registerPlatformServices(new ElectronPlatformServices()) call
    // because Rollup places the shared chunk require() ahead of side-effect
    // imports in the bundled output. Auto-register an inline implementation using
    // electron.app directly so that all platform API callers work regardless of
    // call order. This will be replaced by the proper ElectronPlatformServices
    // once registerPlatformServices() is called.
    if (process.versions?.electron) {
      // In Electron utility processes process.type === 'utility' and app is not
      // accessible. Fall back to NodePlatformServices (DATA_DIR is injected by
      // ElectronPlatformServices.fork so paths still resolve correctly).
      const processType = (process as NodeJS.Process & { type?: string }).type;
      if (processType !== 'browser') {
        _services = new NodePlatformServices();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app, net } = require('electron') as typeof import('electron');
        // E2E must be redirected before any shared module can resolve userData.
        const e2eUserDataDir =
          process.env.AIONUI_E2E_TEST === '1' ? process.env.AIONUI_E2E_USER_DATA_DIR?.trim() : undefined;
        if (e2eUserDataDir) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require('fs') as typeof import('fs');
          fs.mkdirSync(e2eUserDataDir, { recursive: true });
          app.setPath('userData', e2eUserDataDir);
        } else {
          // Rollup can execute this shared chunk before configureChromium.ts
          // and initStorage.ts. Migrate here, before either one can create an
          // empty OpenH3 profile that would block the atomic directory rename.
          const appName = app.isPackaged ? 'OpenH3' : getDevAppName();
          app.setName(appName);
          const appDataDir = app.getPath('appData');
          const legacyName = app.isPackaged
            ? 'AionUi'
            : process.env.AIONUI_MULTI_INSTANCE === '1'
              ? 'AionUi-Dev-2'
              : 'AionUi-Dev';
          const legacyPath = path.join(appDataDir, legacyName);
          const openH3Path = path.join(appDataDir, appName);
          let userDataPath = openH3Path;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const fs = require('fs') as typeof import('fs');
          // Keep an existing legacy profile in place. The database stores
          // absolute paths for imported skills, workspaces, and media jobs;
          // renaming this directory without a transactional path migration
          // makes those records point at files that no longer exist. New
          // installs use the OpenH3 path, while upgraded installs continue to
          // use their intact legacy root until a dedicated path migration is
          // available.
          if (!fs.existsSync(openH3Path) && fs.existsSync(legacyPath)) userDataPath = legacyPath;
          app.setPath('userData', userDataPath);
        }
        // Typed as IPlatformPaths so tsc enforces completeness: any new method
        // added to the interface will cause a compile error here if omitted below.
        const paths: import('./IPlatformServices').IPlatformPaths = {
          getDataDir: () => app.getPath('userData'),
          getTempDir: () => app.getPath('temp'),
          getHomeDir: () => app.getPath('home'),
          getLogsDir: () => {
            try {
              return app.getPath('logs');
            } catch {
              return path.join(app.getPath('userData'), 'logs');
            }
          },
          getAppPath: () => app.getAppPath(),
          isPackaged: () => app.isPackaged,
          getSystemPath: (name) => app.getPath(name),
          getName: () => app.getName(),
          getVersion: () => app.getVersion(),
          needsCliSafeSymlinks: () => process.platform === 'darwin',
        };
        _services = {
          paths,
          worker: {
            fork: () => {
              throw new Error('[Platform] Worker not available before registerPlatformServices()');
            },
          },
          power: { preventSleep: () => null, allowSleep: () => {}, preventDisplaySleep: () => null },
          notification: { send: () => {} },
          network: {
            fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
              net.fetch(input instanceof URL ? input.toString() : input, init),
          },
        };
      }
    } else {
      throw new Error(
        '[Platform] Services not registered. Call registerPlatformServices() before using platform APIs.'
      );
    }
  }
  return _services;
}

export type {
  IPlatformServices,
  IPlatformPaths,
  IWorkerProcess,
  IWorkerProcessFactory,
  IPowerManager,
  INotificationService,
  INetworkService,
} from './IPlatformServices';
