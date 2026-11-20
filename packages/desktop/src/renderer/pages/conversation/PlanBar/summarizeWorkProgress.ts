import type { WorkSnapshot, WorkStatus, WorkTask } from './workProgress';

type Overview = {
  status: WorkStatus | 'partial' | 'history';
  task?: WorkTask;
  media: boolean;
  meter?: { value: number; max: number; unit: 'percent' | 'steps' };
};

export const visibleWorkRows = (tasks: WorkTask[]): WorkTask[] =>
  tasks.flatMap((task) => (task.kind === 'plan' && task.children ? task.children : [task]));

/** The same current activity and measurement are presented in both progress hosts. */
export function summarizeWorkProgress(snapshot: WorkSnapshot): Overview {
  const current = snapshot.tasks.filter((task) => !task.historical);
  if (snapshot.pendingConfirmations > 0) return { status: 'waiting', media: false };
  if (!current.length) return { status: 'history', media: false };
  const leaves = current.flatMap((task) => (task.children?.length ? task.children : [task]));
  const running = leaves.filter((task) => task.status === 'running');
  const generations = current.filter((task) => task.kind === 'generation');
  const runningGeneration = running.find((task) => task.kind === 'generation');
  const task = runningGeneration ?? running[0];
  const plan = current.find((item) => item.kind === 'plan');
  const steps = plan?.children;
  let meter: Overview['meter'];
  const percent = runningGeneration?.progress;
  if (
    typeof percent === 'number' &&
    Number.isFinite(percent) &&
    running.filter((item) => item.kind === 'generation').length === 1
  ) {
    meter = { value: Math.round(Math.min(100, Math.max(0, percent))), max: 100, unit: 'percent' };
  } else if (steps?.length && !generations.length) {
    meter = { value: steps.filter((step) => step.status === 'completed').length, max: steps.length, unit: 'steps' };
  }
  if (task || snapshot.isProcessing) return { status: 'running', task, media: false, meter };
  const waiting = current.find((item) => item.status === 'waiting');
  if (waiting) return { status: 'waiting', media: false, meter };
  const pending = current.find((item) => item.status === 'pending');
  if (pending) return { status: 'pending', media: pending.kind === 'generation', meter };

  // A completed tool invocation and an actual generation are different units.
  // Label the media outcome explicitly. Tool errors remain on their own rows.
  const outcomes = generations.length ? generations : current;
  const states = new Set(outcomes.map((item) => item.status));
  const status =
    generations.length && states.has('completed') && states.size > 1
      ? 'partial'
      : ((['failed', 'interrupted', 'cancelled', 'completed'] as const).find((state) => states.has(state)) ??
        'pending');
  return { status, media: generations.length > 0, meter };
}
