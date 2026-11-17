import React, { useEffect, useRef } from 'react';
import { useSelectionActions } from '@/renderer/components/files/SelectionActions';

/** Same-origin access is only for selection; scripts remain disabled by sandbox and CSP. */
export default function DocumentFrame({ html, title, className }: { html: string; title: string; className: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const detach = useRef<(() => void) | undefined>(undefined);
  const { open, close, menu } = useSelectionActions();
  useEffect(() => {
    close();
    return () => detach.current?.();
  }, [html, close]);
  const attach = () => {
    detach.current?.();
    const document = frame.current!.contentDocument!;
    const context = (event: MouseEvent) => {
      const element = event.target as Element;
      event.preventDefault();
      const box = frame.current!.getBoundingClientRect();
      open(element, { x: box.left + event.clientX, y: box.top + event.clientY }, document.body);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault();
      const box = frame.current!.getBoundingClientRect();
      open(document.activeElement ?? document.body, { x: box.left + 16, y: box.top + 16 }, document.body);
    };
    document.addEventListener('contextmenu', context);
    document.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', close);
    detach.current = () => {
      document.removeEventListener('contextmenu', context);
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('pointerdown', close);
    };
  };
  return (
    <>
      <iframe
        ref={frame}
        className={className}
        title={title}
        sandbox='allow-same-origin'
        srcDoc={html}
        onLoad={attach}
      />
      {menu}
    </>
  );
}
