/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** OpenH3 base components. Legacy exports remain available to extensions. */
export { default as OpenH3Modal, default as AionModal, MODAL_SIZES } from './OpenH3Modal';
export { default as OpenH3Collapse, default as AionCollapse } from './OpenH3Collapse';
export { default as OpenH3Select, default as AionSelect } from './OpenH3Select';
export { default as OpenH3ScrollArea, default as AionScrollArea } from './OpenH3ScrollArea';
export { default as OpenH3Steps, default as AionSteps } from './OpenH3Steps';
export { default as OpenH3SearchInput, default as AionSearchInput } from './OpenH3SearchInput';
export { default as OpenH3InlineSearchInput, default as AionInlineSearchInput } from './OpenH3InlineSearchInput';

export type {
  ModalSize,
  ModalHeaderConfig,
  ModalFooterConfig,
  ModalContentStyleConfig,
  OpenH3ModalProps,
  OpenH3ModalProps as AionModalProps,
} from './OpenH3Modal';
export type {
  OpenH3CollapseProps,
  OpenH3CollapseItemProps,
  OpenH3CollapseProps as AionCollapseProps,
  OpenH3CollapseItemProps as AionCollapseItemProps,
} from './OpenH3Collapse';
export type { OpenH3SelectProps, OpenH3SelectProps as AionSelectProps } from './OpenH3Select';
export type { OpenH3StepsProps, OpenH3StepsProps as AionStepsProps } from './OpenH3Steps';
export type { OpenH3SearchInputProps, OpenH3SearchInputProps as AionSearchInputProps } from './OpenH3SearchInput';
export type {
  OpenH3InlineSearchInputProps,
  OpenH3InlineSearchInputProps as AionInlineSearchInputProps,
} from './OpenH3InlineSearchInput';
