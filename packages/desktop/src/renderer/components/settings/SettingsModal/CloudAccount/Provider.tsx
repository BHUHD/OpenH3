import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type {
  CloudAccountRequest,
  CloudCapabilities,
  CloudSession,
  CloudVerification,
} from '@/common/types/platform/cloudAccount';
import type { IProvider } from '@/common/config/storage';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import { resolveCurrentUserId } from '@/renderer/hooks/system/currentUserId';
import { requestCloudAccount } from './transport';

type View = 'login' | 'register' | 'recovery' | 'proof' | 'reset';
type Ticket = { owner: string | undefined; epoch: number };
type Snapshot = { ticket: Ticket; session: CloudSession; capabilities: CloudCapabilities };
type State = {
  session?: CloudSession;
  capabilities?: CloudCapabilities;
  revision: number;
  busy: boolean;
  view: View;
  error?: string;
  retryAt: number;
  registered: boolean;
  notice?: string;
  challenge?: CloudVerification;
  proofPurpose?: CloudVerification['purpose'];
  reset?: { challenge_id: string; expires_at: number };
};
type Lifecycle = State & {
  available: boolean;
  reload: () => void;
  switchView: (view: View) => void;
  run: (request: CloudAccountRequest) => Promise<void>;
  cancel: () => void;
};
const Context = createContext<Lifecycle | undefined>(undefined);
const empty = (): State => ({ revision: 0, busy: false, view: 'login', retryAt: 0, registered: false });
const identityOperations = new Set(['login', 'logout', 'passwordResetComplete']);

/** One lifecycle for every host. Only the original owner's operation may commit.
 * SWR owns read scheduling; credentials exist only in a form/transport call.
 */
export const CloudAccountProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const auth = useAuth();
  const { mutate } = useSWRConfig();
  const [desktopOwner, setDesktopOwner] = useState<string>();
  useEffect(() => {
    if (auth.status !== 'authenticated' || auth.user?.id || !window.electronAPI) return;
    let live = true;
    void resolveCurrentUserId().then((id) => {
      if (live) setDesktopOwner(id);
    });
    return () => {
      live = false;
    };
  }, [auth.status, auth.user?.id]);
  const owner =
    auth.status === 'authenticated' ? (auth.user?.id ?? (window.electronAPI ? desktopOwner : undefined)) : undefined;
  const [state, setState] = useState<State>(empty);
  const fence = useRef({ owner, epoch: 0 });
  const identityFlight = useRef<(Ticket & { generation?: string; operation: string; failed?: boolean }) | undefined>(
    undefined
  );
  const generation = useRef<string | undefined>(undefined);
  // Fence synchronously during render: an already-resolved A continuation must
  // not run between rendering owner B and B's effects.
  if (fence.current.owner !== owner) {
    fence.current = { owner, epoch: fence.current.epoch + 1 };
    generation.current = undefined;
  }
  const renderedOwner = useRef(owner);
  const belongs = renderedOwner.current === owner;
  const current = belongs ? state : empty();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      fence.current.epoch++;
    };
  }, []);
  useEffect(() => {
    const changed = renderedOwner.current !== owner;
    renderedOwner.current = owner;
    setState((previous) => ({ ...empty(), revision: previous.revision + 1 }));
    if (changed)
      void mutate<IProvider[]>(
        'providers',
        (providers) => providers?.filter((provider) => provider.managed_by !== 'cloud_account'),
        { revalidate: false }
      );
  }, [owner, mutate]);
  const matches = useCallback(
    (ticket: Ticket) => live.current && ticket.owner === fence.current.owner && ticket.epoch === fence.current.epoch,
    []
  );
  const clearProviders = useCallback(
    () =>
      mutate<IProvider[]>(
        'providers',
        (providers) => providers?.filter((provider) => provider.managed_by !== 'cloud_account'),
        { revalidate: false }
      ),
    [mutate]
  );
  const read = useCallback(async (): Promise<Snapshot> => {
    const ticket = { ...fence.current };
    const [session, capabilities] = await Promise.all([
      requestCloudAccount({ operation: 'session' }),
      requestCloudAccount({ operation: 'capabilities' }),
    ]);
    if (!matches(ticket)) throw new Error('CLOUD_CONFLICT');
    if (!session.success || !capabilities.success) throw new Error('CLOUD_TRANSPORT');
    return { ticket, session: session.data as CloudSession, capabilities: capabilities.data as CloudCapabilities };
  }, [matches]);
  const query = useSWR(owner ? ['cloud-account', owner] : null, read, {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    shouldRetryOnError: false,
    keepPreviousData: false,
  });
  useEffect(() => {
    if (!query.data || !owner || !matches(query.data.ticket)) return;
    // A read may observe this mutation's local commit while its remote outcome
    // is still pending. Only the mutation may finish that transition.
    const snapshot = query.data;
    const flight = identityFlight.current;
    if (flight && matches(flight) && flight.generation && 'generation' in snapshot.session) {
      const next = (BigInt(flight.generation) + BigInt(1)).toString();
      const observed = snapshot.session.generation;
      const expected =
        observed === next &&
        (flight.operation === 'login' ||
          (flight.operation === 'logout' && snapshot.session.state === 'disconnected') ||
          (flight.operation === 'passwordResetComplete' && snapshot.session.state === 'reauth_required'));
      if (!flight.failed && (observed === flight.generation || expected)) return;
      const failedTransition =
        expected && (snapshot.session.state === 'disconnected' || snapshot.session.state === 'reauth_required');
      if (flight.failed && (observed === flight.generation || failedTransition)) {
        // begin_login advances even when credentials fail. This original read
        // may finish that failed attempt without erasing a completed registration.
        generation.current = observed;
        identityFlight.current = undefined;
      }
    }
    const nextGeneration = 'generation' in snapshot.session ? snapshot.session.generation : undefined;
    const changed = generation.current !== undefined && generation.current !== nextGeneration;
    generation.current = nextGeneration;
    if (changed) {
      fence.current.epoch++;
      void clearProviders();
      void mutate('providers');
    }
    setState((previous) => {
      return {
        ...(changed ? { ...empty(), revision: previous.revision + 1 } : previous),
        ...snapshot,
        ...(snapshot.session.state === 'verification_required'
          ? { view: 'proof' as const, challenge: snapshot.session.verification, proofPurpose: 'login' as const }
          : {}),
      };
    });
  }, [query.data, owner, matches, clearProviders, mutate]);
  const renderEpoch = fence.current.epoch;
  const cancel = useCallback(() => {
    if (!matches({ owner, epoch: renderEpoch })) return;
    fence.current.epoch++;
    setState((previous) => ({
      ...previous,
      busy: false,
      view: 'login',
      challenge: undefined,
      reset: undefined,
      error: undefined,
      revision: previous.revision + 1,
    }));
  }, [matches, owner, renderEpoch]);
  const switchView = useCallback(
    (view: View) => {
      if (!matches({ owner, epoch: renderEpoch })) return;
      fence.current.epoch++;
      setState((previous) => ({
        ...previous,
        view,
        busy: false,
        error: undefined,
        challenge: undefined,
        reset: undefined,
        revision: previous.revision + 1,
      }));
    },
    [matches, owner, renderEpoch]
  );
  const run = useCallback(
    async (request: CloudAccountRequest) => {
      if (!owner || !matches({ owner, epoch: renderEpoch })) return;
      // All deliberate operations supersede previous form requests; never retry
      // ambiguous credential mutations. The ticket is captured before awaiting.
      fence.current.epoch++;
      const ticket = { ...fence.current };
      const identity = identityOperations.has(request.operation);
      if (identity)
        identityFlight.current = { ...ticket, generation: generation.current, operation: request.operation };
      setState((previous) => ({
        ...previous,
        busy: true,
        error: undefined,
        ...(identity
          ? { session: undefined, challenge: undefined, reset: undefined, revision: previous.revision + 1 }
          : {}),
      }));
      if (identity) void clearProviders();
      const result = await requestCloudAccount(request);
      if (!matches(ticket)) return;
      if (identity && identityFlight.current) {
        if (result.success) identityFlight.current = undefined;
        else identityFlight.current.failed = true;
      }
      if (result.success === false) {
        const retry = result.retry_after ?? result.details?.retry_after ?? 0;
        setState((previous) => ({ ...previous, busy: false, error: result.code, retryAt: Date.now() + retry * 1000 }));
        if (identity || result.code === 'CLOUD_AUTH_REQUIRED' || result.code === 'CLOUD_CONFLICT') {
          void mutate('providers');
          void query.mutate();
        }
        return;
      }
      const data = result.data;
      let connected: CloudSession | undefined;
      if (request.operation === 'login') connected = data as CloudSession;
      if (data && 'result' in data && data.result === 'login') connected = data.session;
      if (connected) {
        // Publish through SWR's mutation boundary: reads begun before this
        // completed login/proof cannot replace it, even at the same generation.
        // Keep the original operation ticket valid for its catalog continuation.
        void query.mutate(undefined, { revalidate: false });
      }
      if (connected && 'generation' in connected) generation.current = connected.generation;
      if (request.operation === 'logout' || request.operation === 'passwordResetComplete')
        generation.current = undefined;
      setState((previous) => {
        let next: State = { ...previous, busy: false, error: undefined };
        if (request.operation === 'register')
          next = { ...next, registered: true, view: 'login', revision: next.revision + 1 };
        if (request.operation === 'emailCode') next.notice = 'codeSent';
        if (request.operation === 'logout' && data && 'remote_revocation' in data)
          next = {
            ...next,
            session: undefined,
            notice: data.remote_revocation === 'unconfirmed' ? 'logoutUnconfirmed' : 'logoutConfirmed',
            view: 'login',
          };
        if (request.operation === 'passwordResetComplete')
          next = {
            ...next,
            view: 'login',
            reset: undefined,
            challenge: undefined,
            revision: next.revision + 1,
            notice:
              data && 'session_cleanup_pending' in data && data.session_cleanup_pending
                ? 'resetCleanupPending'
                : 'resetComplete',
          };
        if (data && 'status' in data && data.status === 'ready')
          next = { ...next, view: 'reset', reset: data as State['reset'], revision: next.revision + 1 };
        if (data && 'result' in data && data.result === 'password_reset_ready')
          next = { ...next, view: 'reset', reset: data, challenge: undefined, revision: next.revision + 1 };
        if (data && 'status' in data && data.status === 'verification_required' && 'verification' in data)
          next = {
            ...next,
            view: 'proof',
            challenge: data.verification,
            proofPurpose: 'password_reset',
            revision: next.revision + 1,
          };
        if (connected)
          next = {
            ...next,
            session: connected,
            view: connected.state === 'verification_required' ? 'proof' : 'login',
            challenge: connected.state === 'verification_required' ? connected.verification : undefined,
            proofPurpose: connected.state === 'verification_required' ? 'login' : undefined,
            revision: next.revision + 1,
          };
        return next;
      });
      if (connected?.state === 'connected') {
        // Catalog admission is Core-owned. Revalidate the existing providers key
        // after success AND failure because failure clears admission as well.
        const catalog = await requestCloudAccount({ operation: 'models' });
        if (!matches(ticket)) return;
        setState((previous) => ({
          ...previous,
          notice:
            !catalog.success || (catalog.data && 'status' in catalog.data && catalog.data.status === 'unavailable')
              ? 'catalogFailed'
              : undefined,
        }));
        void mutate('providers');
      } else if (identity) {
        void mutate('providers');
        if (request.operation !== 'login') void query.mutate();
      }
    },
    [clearProviders, matches, mutate, query.mutate, owner, renderEpoch]
  );
  const value: Lifecycle = {
    ...current,
    error: current.error ?? (query.error ? 'CLOUD_TRANSPORT' : undefined),
    available: !!owner,
    run,
    cancel,
    switchView,
    reload: () => {
      if (!matches({ owner, epoch: renderEpoch })) return;
      void query.mutate();
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
};
export const useCloudAccount = (): Lifecycle => {
  const context = useContext(Context);
  if (!context) throw new Error('CloudAccountProvider is required');
  return context;
};
export const useOptionalCloudAccount = (): Lifecycle | undefined => useContext(Context);
