import React from 'react';
import { useTranslation } from 'react-i18next';
import { DocumentState } from './DocumentState';
import DocumentFrame from './DocumentFrame';
import { renderWord } from './documentRendering';
import { useDocumentPreview, type DocumentPreviewProps } from './useDocumentPreview';

export default function WordPreview(props: DocumentPreviewProps) {
  const { t } = useTranslation();
  const { value, error } = useDocumentPreview(props, renderWord);
  if (value === undefined) return <DocumentState error={error} errorKey='preview.word.loadFailed' />;
  return <DocumentFrame className='w-full h-full border-none' title={t('preview.word.title')} html={value} />;
}
