import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { copyText } from '@/renderer/utils/ui/clipboard';
import { ContextActions, contextMenuKey, type MenuPoint } from './ContextActions';

export function tableText(table: HTMLTableElement): string {
  return Array.from(table.rows, (row) =>
    Array.from(row.cells, (cell) => (cell.textContent ?? '').trim().replace(/[\t\r\n]+/g, ' ')).join('\t')
  ).join('\n');
}

/** Capture text before the menu takes focus. Copying a cell never copies a whole sheet. */
export function useSelectionActions() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<{
    point: MenuPoint;
    text: string;
    table?: string;
    selectAll: () => void;
  } | null>(null);
  const close = useCallback(() => setTarget(null), []);
  const open = (element: Element, point: MenuPoint, root: HTMLElement) => {
    const doc = root.ownerDocument;
    const selected = doc.getSelection()?.toString() ?? '';
    const cell = element.closest('td,th');
    const table = element.closest('table');
    setTarget({
      point,
      text: selected || cell?.textContent?.trim() || '',
      table: table ? tableText(table) : undefined,
      selectAll: () => {
        const range = doc.createRange();
        range.selectNodeContents(root);
        const selection = doc.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      },
    });
  };
  const menu = (
    <ContextActions
      point={target?.point ?? null}
      onClose={close}
      actions={[
        { key: 'copy', label: t('common.copy'), disabled: !target?.text, run: () => copyText(target?.text ?? '') },
        ...(target?.table !== undefined
          ? [{ key: 'copyTable', label: t('preview.copyTable'), run: () => copyText(target.table!) }]
          : []),
        { key: 'selectAll', label: t('preview.selectAll'), run: () => target?.selectAll() },
      ]}
    />
  );
  return { open, close, menu };
}

/** Read-only preview contents share the same selection menu as Office documents. */
export function SelectionActions({ children, className }: { children: React.ReactNode; className?: string }) {
  const { open, menu } = useSelectionActions();
  return (
    <div
      className={className}
      tabIndex={0}
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          !(event.target instanceof Element) ||
          event.target.closest('input,textarea,[contenteditable="true"],iframe,webview')
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        open(event.target, { x: event.clientX, y: event.clientY }, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget)
          contextMenuKey(event, (point) => open(event.currentTarget, point, event.currentTarget));
      }}
    >
      {children}
      {menu}
    </div>
  );
}
