import OpenH3Select from '@/renderer/components/base/OpenH3Select';
import type { SelectHandle } from '@arco-design/web-react/es/Select/interface';
import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '@/renderer/services/i18n';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();
  const selectRef = useRef<SelectHandle>(null);

  const handleLanguageChange = useCallback((value: string) => {
    // 切换前先 blur 触发元素，避免弹层和语言切换竞争布局
    // Blur before switching to avoid dropdown and language change fighting for layout
    selectRef.current?.blur?.();

    const applyLanguage = () => {
      changeLanguage(value).catch((error: Error) => {
        console.error('Failed to change language:', error);
      });
    };

    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      // 延迟到下一帧执行，确保 DOM 动画已完成 / defer to next frame so DOM animations finish
      window.requestAnimationFrame(() => window.requestAnimationFrame(applyLanguage));
    } else {
      setTimeout(applyLanguage, 0);
    }
  }, []);

  return (
    <div className='flex items-center gap-8px'>
      <OpenH3Select ref={selectRef} className='w-160px' value={i18n.language} onChange={handleLanguageChange}>
        <OpenH3Select.Option value='zh-CN'>简体中文</OpenH3Select.Option>
        <OpenH3Select.Option value='zh-TW'>繁體中文</OpenH3Select.Option>
        <OpenH3Select.Option value='ja-JP'>日本語</OpenH3Select.Option>
        <OpenH3Select.Option value='ko-KR'>한국어</OpenH3Select.Option>
        <OpenH3Select.Option value='tr-TR'>Türkçe</OpenH3Select.Option>
        <OpenH3Select.Option value='ru-RU'>Русский</OpenH3Select.Option>
        <OpenH3Select.Option value='uk-UA'>Українська</OpenH3Select.Option>
        <OpenH3Select.Option value='pt-BR'>Português (BR)</OpenH3Select.Option>
        <OpenH3Select.Option value='de-DE'>Deutsch</OpenH3Select.Option>
        <OpenH3Select.Option value='es-ES'>Español</OpenH3Select.Option>
        <OpenH3Select.Option value='fr-FR'>Français</OpenH3Select.Option>
        <OpenH3Select.Option value='fa-IR'>فارسی</OpenH3Select.Option>
        <OpenH3Select.Option value='en-US'>English</OpenH3Select.Option>
      </OpenH3Select>
    </div>
  );
};

export default LanguageSwitcher;
