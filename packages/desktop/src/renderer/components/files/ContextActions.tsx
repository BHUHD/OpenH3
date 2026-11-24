import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Message } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import styles from './FilePreview.module.css';

export type ContextAction = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  run: () => void | Promise<void>;
};
export type MenuPoint = { x: number; y: number; trigger?: HTMLElement };

/** A shared, keyboard-accessible menu, also used by scriptless document frames. */
export function ContextActions({
  point,
  actions,
  onClose,
}: {
  point: MenuPoint | null;
  actions: ContextAction[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    if (!point || !root.current) return;
    const box = root.current.getBoundingClientRect();
    const left = point.trigger ? point.x - box.width : point.x;
    setPosition({
      x: Math.max(8, Math.min(left, window.innerWidth - box.width - 8)),
      y: Math.max(8, Math.min(point.y, window.innerHeight - box.height - 8)),
    });
  }, [point, actions.length]);
  useLayoutEffect(() => {
    if (!point || !root.current) return;
    const previousFocus = point.trigger ?? document.activeElement;
    root.current
      .querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [point]);
  useEffect(() => {
    if (!point) return;
    const close = (event: Event) => {
      if (point.trigger && event.composedPath().includes(point.trigger)) return;
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', onClose);
    };
  }, [point, onClose]);
  if (!point) return null;
  return createPortal(
    <div
      ref={root}
      style={{
        position: 'fixed',
        left: position?.x ?? point.x,
        top: position?.y ?? point.y,
        zIndex: 10000,
        minWidth: 190,
        maxHeight: 'calc(100dvh - 16px)',
        overflowY: 'auto',
        boxShadow: 'var(--shadow-2)',
        border: '1px solid var(--color-border-2)',
        borderRadius: 8,
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const items = Array.from(
            root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []
          );
          const current = items.indexOf(document.activeElement as HTMLElement);
          items[(current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
      }}
    >
      <Menu className={styles.menu} selectable={false} style={{ borderRadius: 8 }}>
        {actions.map((action) => (
          <Menu.Item
            key={action.key}
            disabled={action.disabled}
            aria-disabled={action.disabled || undefined}
            onClick={() => {
              onClose();
              void Promise.resolve()
                .then(action.run)
                .catch(() => Message.error(t('preview.fileActionFailed')));
            }}
          >
            <span className='flex items-center gap-8px'>
              {action.icon}
              {action.label}
            </span>
          </Menu.Item>
        ))}
      </Menu>
    </div>,
    document.body
  );
}

/** Shift+F10 and the Menu key open the same menu as a pointer gesture. */
export function contextMenuKey(event: React.KeyboardEvent<HTMLElement>, open: (point: MenuPoint) => void) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  event.stopPropagation();
  const box = event.currentTarget.getBoundingClientRect();
  open({ x: box.left, y: box.bottom });
}
