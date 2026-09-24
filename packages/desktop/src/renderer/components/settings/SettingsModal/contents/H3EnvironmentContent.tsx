import { H3LiveProgress } from '@renderer/pages/conversation/Messages/components/H3ToolResults';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { h3JobApi, type H3RuntimeStatus } from '@/common/chat/document/h3JobApi';
import type { H3SetupState, H3SetupPlan, H3HardwareAssessment } from '@/common/chat/document/h3Setup';
import type { H3Job } from '@/common/chat/document/h3Job';

/** Available in system settings before the user has created a video. */
export default function H3EnvironmentContent({
  automatic = false,
  onReady,
}: { automatic?: boolean; onReady?: () => void } = {}) {
  const { t } = useTranslation();
  const attemptedRoot = useRef<string | undefined>(undefined);
  const [status, setStatus] = useState<H3RuntimeStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<H3SetupState>({ phase: 'idle' });
  const [plan, setPlan] = useState<H3SetupPlan>();
  const [accepted, setAccepted] = useState(false);
  const [hardware, setHardware] = useState<H3HardwareAssessment>();
  const [experimental, setExperimental] = useState(false);
  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<typeof h3JobApi.setupCapabilities>>>();
  const [smoke, setSmoke] = useState<H3Job>();
  const smokeActive = smoke?.status === 'queued' || smoke?.status === 'running';
  useEffect(() => {
    if (!smokeActive || !smoke?.id) return;
    let disposed = false;
    const timer = setInterval(() => {
      void h3JobApi
        .get(smoke.id)
        .then((next) => {
          if (!disposed) setSmoke(next);
        })
        .catch(() => {
          if (!disposed) setError(t('settings.h3Setup.pollFailed'));
        });
    }, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [smoke?.id, smokeActive]);
  const startRuntime = async () => {
    setBusy(true);
    setError('');
    setCapabilities(undefined);
    try {
      await h3JobApi.startRuntime();
      const checked = await h3JobApi.setupCapabilities();
      setCapabilities(checked);
      if (!checked.nodesAvailable || !checked.modelsAvailable) throw new Error(t('settings.h3Setup.missingModels'));
      setStatus(await h3JobApi.status());
      onReady?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.h3Setup.startFailed'));
    } finally {
      setBusy(false);
    }
  };
  const testGeneration = async () => {
    setBusy(true);
    setError('');
    try {
      const current = await h3JobApi.setupCapabilities();
      setCapabilities(current);
      if (!current.nodesAvailable || !current.modelsAvailable) throw new Error(t('settings.h3Setup.missingModels'));
      setSmoke(
        await h3JobApi.create({
          prompt: 'A quiet mountain lake at sunrise, gentle camera movement, natural ambient sound.',
          durationSeconds: 4,
          megapixels: 0.2,
          seed: 42,
          mode: 't2v',
          references: [],
        })
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.h3Setup.testFailed'));
    } finally {
      setBusy(false);
    }
  };
  const cancelSmoke = async () => {
    if (!smoke) return;
    setBusy(true);
    try {
      setSmoke(await h3JobApi.cancel(smoke.id));
    } catch {
      setError(t('settings.h3Setup.cancelFailed'));
    } finally {
      setBusy(false);
    }
  };
  const gib = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GiB`;
  const installing = ['downloading', 'verifying', 'extracting', 'installing-acceleration'].includes(setup.phase);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await h3JobApi.setup();
        if (!cancelled) setSetup(next);
      } catch {
        /* the refresh action reports connection failures */
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!automatic || busy || installing || !status || !hardware || hardware.status === 'blocked') return;
    const root = status.install.bundleRoot;
    if (attemptedRoot.current === root) return;
    if (status.readiness === 'ready' || (setup.phase === 'installed' && setup.bundleRoot === root)) {
      attemptedRoot.current = root;
      void startRuntime();
    }
  }, [automatic, busy, installing, status, hardware, setup.phase, setup.bundleRoot]);
  const install = async (download = false) => {
    attemptedRoot.current = undefined;
    setBusy(true);
    setError('');
    try {
      setSetup(
        await h3JobApi.install(
          download
            ? {
                download: true,
                acceptModelTerms: accepted,
                ...(experimental ? { acceptExperimentalHardware: true } : {}),
              }
            : undefined
        )
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.h3Setup.installFailed'));
    } finally {
      setBusy(false);
    }
  };
  const pause = async () => {
    setBusy(true);
    setError('');
    try {
      setSetup(await h3JobApi.pauseSetup());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('settings.h3Setup.pauseFailed'));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      setStatus(await h3JobApi.status());
      setPlan(await h3JobApi.setupPlan());
      setHardware(await h3JobApi.setupHardware());
    } catch {
      setError(t('settings.h3Setup.serviceUnavailable'));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const checkCapabilities = async () => {
    setBusy(true);
    setError('');
    setCapabilities(undefined);
    try {
      setCapabilities(await h3JobApi.setupCapabilities());
    } catch {
      setError(t('settings.h3Setup.capabilityFailed'));
    } finally {
      setBusy(false);
    }
  };
  const choose = async () => {
    setBusy(true);
    setError('');
    try {
      const paths = await ipcBridge.dialog.showOpen.invoke({ properties: ['openDirectory', 'createDirectory'] });
      if (paths?.[0]) {
        setPlan(undefined);
        setAccepted(false);
        setStatus(await h3JobApi.configureBundleRoot(paths[0]));
        setPlan(await h3JobApi.setupPlan());
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        message.includes('JOBS_ACTIVE')
          ? t('settings.h3Setup.jobsActive')
          : message.includes('OVERRIDE_ACTIVE')
            ? t('settings.h3Setup.override')
            : t('settings.h3Setup.folderFailed')
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className='flex flex-col min-h-0' aria-label={t('settings.h3Setup.title')}>
      <div
        className='overflow-y-auto min-h-0 pr-8px space-y-20px'
        style={{ maxHeight: automatic ? 'min(52vh, 520px)' : '60vh' }}
      >
        <div className='space-y-8px'>
          <div className='flex items-center justify-between gap-12px'>
            <h3 className='m-0 text-16px font-500'>{t('settings.h3Setup.title')}</h3>
            <Button loading={busy} onClick={() => void refresh()}>
              {t('settings.h3Setup.refresh')}
            </Button>
          </div>{' '}
          {status && (
            <>
              <p>
                {status.ready
                  ? t('settings.h3Setup.connected')
                  : status.readiness === 'ready'
                    ? t('settings.h3Setup.prepared')
                    : t('settings.h3Setup.incomplete')}
              </p>

              <p>
                {t('settings.h3Setup.missingSummary', {
                  models: status.install.missingAssets.length,
                  nodes: status.install.missingCustomNodes.length,
                  verification: status.install.bundleVerified
                    ? t('settings.h3Setup.verified')
                    : t('settings.h3Setup.unverified'),
                })}
              </p>
            </>
          )}
        </div>
        {status?.acceleration && (
          <div className='text-12px text-t-secondary'>
            <p>
              {t(
                status.acceleration.backend === 'sla'
                  ? 'settings.h3Setup.accelerationAuto'
                  : 'settings.h3Setup.accelerationFallback'
              )}
            </p>
            <p>{t('settings.h3Setup.accelerationReason', { reason: status.acceleration.reason })}</p>
          </div>
        )}
        <div className='border-t border-3 pt-16px space-y-8px' data-testid='h3-setup-hardware'>
          <h4 className='m-0 text-14px font-500'>{t('settings.h3Setup.hardwareSection')}</h4>{' '}
          {hardware && (
            <div>
              <p>
                {t('settings.h3Setup.hardwareSummary', {
                  gpu: hardware.gpuNames.join(', ') || t('settings.h3Setup.noGpu'),
                  memory: hardware.memoryGiB.toFixed(1),
                  driver: hardware.driver ?? t('settings.h3Setup.unknown'),
                })}
              </p>
              <p>
                {hardware.status === 'blocked'
                  ? t('settings.h3Setup.blocked')
                  : hardware.status === 'unverified'
                    ? t('settings.h3Setup.experimental')
                    : t('settings.h3Setup.baseline')}
              </p>
              {hardware.reasons.includes('RAM_BELOW_TESTED_BASELINE') && <p>{t('settings.h3Setup.ram')}</p>}
              {hardware.status === 'unverified' && (
                <Checkbox checked={experimental} disabled={busy || installing} onChange={setExperimental}>
                  {t('settings.h3Setup.experimentalConsent')}
                </Checkbox>
              )}
            </div>
          )}
        </div>
        <div className='border-t border-3 pt-16px space-y-8px'>
          <div className='flex items-center justify-between gap-12px'>
            <h4 className='m-0 text-14px font-500'>{t('settings.h3Setup.storageSection')}</h4>
            <Button disabled={busy || installing} onClick={() => void choose()}>
              {t('settings.h3Setup.choose')}
            </Button>
          </div>
          {status && <p className='m-0 break-all text-13px text-t-secondary'>{status.install.bundleRoot}</p>}
          {plan && (
            <div>
              <p>
                {t('settings.h3Setup.downloadSummary', {
                  download: gib(plan.downloadBytes),
                  reserve: gib(plan.reserveBytes),
                })}
              </p>
              <p>
                {t('settings.h3Setup.diskSummary', { free: gib(plan.freeBytes), required: gib(plan.requiredBytes) })}
              </p>
              {!plan.enough && <p role='alert'>{t('settings.h3Setup.lowDisk')}</p>}
            </div>
          )}
        </div>
        <div className='space-y-8px' aria-live='polite'>
          {' '}
          {setup.filename && setup.bundleRoot === status?.install.bundleRoot && (
            <div>
              <p className='break-all'>{setup.filename}</p>
              {setup.sourceHost && <p className='text-t-secondary'>{setup.sourceHost}</p>}
              {setup.phase === 'downloading' && !!setup.retryAttempt && (
                <p role='status'>
                  {t('settings.h3Setup.retrying', {
                    attempt: setup.retryAttempt,
                    seconds: Math.ceil((setup.retryDelayMs ?? 0) / 1000),
                  })}
                </p>
              )}
              <progress
                aria-label={t('settings.h3Setup.progress')}
                style={{ width: '100%' }}
                max={Math.max(1, setup.totalBytes ?? 1)}
                value={setup.bytes ?? 0}
              />
              <p>
                {gib(setup.bytes ?? 0)} / {gib(setup.totalBytes ?? 0)}
              </p>
            </div>
          )}
          {error && <p role='alert'>{error}</p>}
          {setup.phase !== 'idle' && (
            <p role='status'>
              {
                {
                  downloading: t('settings.h3Setup.downloading'),
                  verifying: t('settings.h3Setup.verifying'),
                  extracting: t('settings.h3Setup.extracting'),
                  'installing-acceleration': t('settings.h3Setup.installingAcceleration'),
                  installed: t('settings.h3Setup.installed'),
                  paused: t('settings.h3Setup.paused'),
                  failed: t('settings.h3Setup.failed'),
                  idle: '',
                }[setup.phase]
              }
            </p>
          )}
          {setup.error && (
            <details>
              <summary>{t('settings.h3Setup.errorDetails')}</summary>
              <p className='break-all'>{setup.error}</p>
            </details>
          )}
        </div>
        <details className='border-t border-3 pt-12px pb-12px'>
          <summary className='cursor-pointer text-t-secondary'>{t('settings.h3Setup.advancedSection')}</summary>
          <div className='pt-12px space-y-12px'>
            {' '}
            {capabilities && (
              <div>
                <p>
                  {capabilities.nodesAvailable ? t('settings.h3Setup.nodesReady') : t('settings.h3Setup.nodesMissing')}
                </p>
                {capabilities.modes.map((mode) => (
                  <p key={mode.mode} className='break-all'>
                    {mode.mode}: {mode.missingNodes.join(', ') || t('settings.h3Setup.nodeComplete')}
                  </p>
                ))}
                <p className='break-all'>
                  {capabilities.modelsAvailable
                    ? t('settings.h3Setup.modelsReady')
                    : t('settings.h3Setup.missingModelNames', { models: capabilities.missingModels.join(', ') })}
                </p>
              </div>
            )}
            {smoke && (
              <div>
                <p role='status'>{t(`conversation.h3Activity.${smoke.status}`)}</p>
                {smokeActive && <H3LiveProgress job={smoke} unavailable={false} />}
                {smoke.error && <p role='alert'>{smoke.error}</p>}
                {smoke.status === 'succeeded' && smoke.artifacts[0]?.resourcePath && (
                  <video
                    controls
                    preload='metadata'
                    style={{ width: '100%', maxHeight: 260 }}
                    src={h3JobApi.resourceUrl(smoke.artifacts[0].resourcePath)}
                  />
                )}
              </div>
            )}
            <div className='flex flex-wrap gap-8px'>
              <Button disabled={busy || installing} onClick={() => void install()}>
                {t('settings.h3Setup.offlineInstall')}
              </Button>
              <Button disabled={busy || installing} onClick={() => void checkCapabilities()}>
                {t('settings.h3Setup.check')}
              </Button>
              <Button
                disabled={
                  busy || installing || smokeActive || !capabilities?.modelsAvailable || !capabilities.nodesAvailable
                }
                onClick={() => void testGeneration()}
              >
                {t('settings.h3Setup.test')}
              </Button>
              {smokeActive && (
                <Button disabled={busy} onClick={() => void cancelSmoke()}>
                  {t('settings.h3Setup.cancel')}
                </Button>
              )}
            </div>
          </div>
        </details>
      </div>
      <footer className='border-t border-3 pt-16px mt-12px space-y-12px' data-testid='h3-setup-footer'>
        <p className='flex flex-wrap gap-8px'>
          <a
            href='https://huggingface.co/MATLOWAI/minimax-h3-fused-turbo-int8-convrot'
            target='_blank'
            rel='noreferrer'
          >
            {t('settings.h3Setup.fusedSource')}
          </a>
          <a href='https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE' target='_blank' rel='noreferrer'>
            {t('settings.h3Setup.modelSource')}
          </a>
          <a
            href='https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE'
            target='_blank'
            rel='noreferrer'
          >
            {t('settings.h3Setup.vaeSource')}
          </a>
        </p>
        <Checkbox checked={accepted} disabled={busy || installing} onChange={setAccepted}>
          {t('settings.h3Setup.terms')}
        </Checkbox>

        <div className='flex flex-wrap justify-end gap-8px'>
          {setup.phase === 'downloading' && (
            <Button disabled={busy} onClick={() => void pause()}>
              {t('settings.h3Setup.pause')}
            </Button>
          )}
          <Button
            disabled={busy || installing || smokeActive || !hardware || hardware.status === 'blocked'}
            onClick={() => void startRuntime()}
          >
            {t('settings.h3Setup.start')}
          </Button>
          <Button
            type='primary'
            disabled={
              busy ||
              installing ||
              !accepted ||
              !plan?.enough ||
              !hardware ||
              hardware.status === 'blocked' ||
              (hardware.status === 'unverified' && !experimental)
            }
            onClick={() => void install(true)}
          >
            {setup.download && ['paused', 'failed'].includes(setup.phase)
              ? t('settings.h3Setup.resume')
              : t('settings.h3Setup.download')}
          </Button>
        </div>
      </footer>
    </section>
  );
}

/** First-run setup stays discoverable before a conversation or video exists. */
export function H3FirstRunSetup() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [probeError, setProbeError] = useState(false);
  useEffect(() => {
    let disposed = false;
    // The media service may still be starting when the renderer mounts.
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const inspect = async () => {
      try {
        const status = await h3JobApi.status();
        if (!disposed) setVisible(!status.ready);
      } catch {
        if (!disposed) {
          if (++attempts < 5) timer = setTimeout(() => void inspect(), 2000);
          else {
            setProbeError(true);
            setVisible(true);
          }
        }
      }
    };
    void inspect();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);
  return (
    <Modal
      visible={visible}
      title={t('settings.h3Setup.firstRunTitle')}
      footer={null}
      onCancel={() => setVisible(false)}
      style={{ width: 'min(760px, 94vw)' }}
      unmountOnExit
    >
      {visible && (
        <>
          <p className='text-t-secondary text-13px leading-relaxed mb-20px'>
            {t('settings.h3Setup.firstRunDescription')}
          </p>
          {probeError && <p role='alert'>{t('settings.h3Setup.serviceUnavailable')}</p>}
          <H3EnvironmentContent automatic onReady={() => setVisible(false)} />
        </>
      )}
    </Modal>
  );
}
