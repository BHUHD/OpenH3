import { Button } from '@arco-design/web-react';
import { Check, CloseOne, Down, PauseOne, Time } from '@icon-park/react';
import { requestConversationSendBoxPrefill } from '@/renderer/hooks/chat/useSendBoxDraft';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ComfyOperationResult from '@/renderer/pages/conversation/runtime/Creation/ComfyOperationResult';
import { useWorkProgress, type WorkTask } from './workProgress';
import { summarizeWorkProgress, visibleWorkRows } from './summarizeWorkProgress';
import GenerationQueue from '@/renderer/pages/conversation/runtime/GenerationCard/GenerationQueue';
import styles from './WorkProgress.module.css';

export default function ConversationWorkProgress({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const snapshot = useWorkProgress(conversationId);
  const [openedOperations, setOpenedOperations] = useState<Set<string>>(() => new Set());
  const current = snapshot.tasks.filter((task) => !task.historical);
  const history = snapshot.tasks.filter((task) => task.historical);
  const overview = summarizeWorkProgress(snapshot);
  const meter = overview.meter;
  const measurement =
    meter?.unit === 'percent'
      ? `${meter.value}%`
      : meter && t('conversation.planBar.progress', { completed: meter.value, total: meter.max });
  const toggleOperation = (id: string) =>
    setOpenedOperations((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const row = (task: WorkTask): React.ReactNode => (
    <li key={task.id} data-work-task={task.kind} data-status={task.status} className={styles.task}>
      <div className={styles.taskRow} aria-current={task.status === 'running' ? 'step' : undefined}>
        <span
          className={styles.statusIcon}
          data-status={task.status}
          role='img'
          aria-label={t(`conversation.workProgress.statuses.${task.status}`)}
        >
          {task.status === 'completed' ? (
            <Check size={12} strokeWidth={4} fill='var(--text-white)' />
          ) : task.status === 'failed' ? (
            <CloseOne size={18} fill='var(--danger)' />
          ) : task.status === 'waiting' ? (
            <Time size={18} fill='var(--warning)' />
          ) : task.status === 'interrupted' || task.status === 'cancelled' ? (
            <PauseOne size={18} fill='var(--text-secondary)' />
          ) : (
            <span className={task.status === 'running' ? styles.spinner : styles.pendingIcon} aria-hidden='true' />
          )}
        </span>
        <div className='min-w-0 flex-1'>
          <div className={styles.taskTitle}>
            {task.summaryKey
              ? t(`conversation.workProgress.summaries.${task.summaryKey}`)
              : task.title || t(`conversation.workProgress.kinds.${task.kind}`)}
          </div>
          {task.preparing && <div className={styles.detail}>{t('conversation.workProgress.detecting')}</div>}
          {['failed', 'interrupted', 'waiting', 'cancelled'].includes(task.status) && (
            <div className={styles.detail}>{t(`conversation.workProgress.statuses.${task.status}`)}</div>
          )}
          {task.diagnosis && <div className={styles.detail}>{t(`conversation.workProgress.${task.diagnosis}`)}</div>}
          {task.generationWarning && (
            <div className={styles.detail}>{t(`conversation.h3Activity.${task.generationWarning}`)}</div>
          )}
          {task.detail && <div className={styles.detail}>{task.detail}</div>}
          {task.operationId && (
            <Button
              size='mini'
              type='text'
              className={styles.detailsButton}
              aria-expanded={openedOperations.has(task.operationId)}
              icon={<Down size={12} className={openedOperations.has(task.operationId) ? styles.expanded : undefined} />}
              onClick={() => {
                if (task.operationId) toggleOperation(task.operationId);
              }}
            >
              {t('guid.comfy.operation.details')}
            </Button>
          )}
          {task.operationId && openedOperations.has(task.operationId) && (
            <ComfyOperationResult id={task.operationId} conversationId={conversationId} />
          )}
        </div>
        <GenerationQueue tasks={[task]} />
      </div>
      {!!task.children?.length && <ol className={styles.subtasks}>{task.children.map(row)}</ol>}
    </li>
  );
  return (
    <section
      data-testid='conversation-work-progress'
      className={styles.panel}
      aria-label={t('conversation.workProgress.title')}
    >
      {!!snapshot.tasks.length && overview.status !== 'history' && (
        <div className={styles.overview}>
          <div className={styles.summary}>
            {meter && <span className={styles.count}>{measurement}</span>}
            <span
              role='status'
              aria-live='polite'
              aria-atomic='true'
              className={styles.overallStatus}
              data-status={overview.status}
            >
              {overview.media && <>{t('conversation.workProgress.kinds.generation')} · </>}
              {overview.status === 'partial'
                ? t('conversation.workProgress.partial')
                : t(`conversation.workProgress.statuses.${overview.status}`)}
            </span>
          </div>
          {meter && (
            <div
              className={styles.progressTrack}
              role='progressbar'
              aria-label={t('conversation.workProgress.title')}
              aria-valuemin={0}
              aria-valuemax={meter.max}
              aria-valuenow={meter.value}
              aria-valuetext={measurement}
            >
              <div className={styles.progressFill} style={{ width: `${(meter.value / meter.max) * 100}%` }} />
            </div>
          )}
        </div>
      )}
      {snapshot.pendingConfirmations > 0 && (
        <p className={styles.waitingHint}>{t('conversation.workProgress.waitingHint')}</p>
      )}
      {!snapshot.tasks.length ? (
        <p className={styles.empty}>{t('conversation.workProgress.empty')}</p>
      ) : (
        <>
          {!!current.length && (
            <ol className={styles.tasks} aria-label={t('conversation.workProgress.title')}>
              {visibleWorkRows(current).map(row)}
            </ol>
          )}
          {!!history.length && (
            <>
              <div className={styles.detail}>{t('conversation.workProgress.history')}</div>
              <ol className={styles.tasks} aria-label={t('conversation.workProgress.history')}>
                {visibleWorkRows(history).map(row)}
              </ol>
            </>
          )}
        </>
      )}
      {!snapshot.isProcessing &&
        !overview.media &&
        current.some(
          (task) => ['interrupted', 'failed'].includes(task.status) && task.kind !== 'generation' && !task.operationId
        ) && (
          <Button
            className={styles.resumeButton}
            size='small'
            onClick={() =>
              requestConversationSendBoxPrefill(conversationId, t('conversation.workProgress.resumePrompt'))
            }
          >
            {t('conversation.workProgress.prepareResume')}
          </Button>
        )}
    </section>
  );
}
