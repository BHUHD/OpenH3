import type { ModalProps } from '@arco-design/web-react';
import { Modal } from '@arco-design/web-react';
import { Close } from '@icon-park/react';
import React from 'react';

interface ModalWrapperProps extends Omit<ModalProps, 'title'> {
  children?: React.ReactNode;
  title?: React.ReactNode;
  showCustomClose?: boolean;
}

const ModalWrapper: React.FC<ModalWrapperProps> = ({
  children,
  title,
  showCustomClose = true,
  onCancel,
  className = '',
  ...props
}) => {
  return (
    <Modal
      {...props}
      title={null}
      closable={false}
      onCancel={onCancel}
      className={`openh3-modal aionui-modal ${className}`}
    >
      <div>
        {showCustomClose && title && (
          <div className='openh3-modal-header aionui-modal-header'>
            <h3 className='openh3-modal-title aionui-modal-title'>{title}</h3>
            <button onClick={onCancel} className='openh3-modal-close-btn aionui-modal-close-btn'>
              <Close size={20} fill='var(--bg-6)' />
            </button>
          </div>
        )}
        {children}
      </div>
    </Modal>
  );
};

export default ModalWrapper;
