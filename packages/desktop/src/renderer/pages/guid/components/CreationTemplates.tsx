import { Button } from '@arco-design/web-react';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREATION_TEMPLATES, type CreationTemplate } from '../utils/creationTemplates';
import { creationMasonry } from '../Creation/masonry';
import CreationTemplateCard from './CreationTemplateCard';
import styles from '../index.module.css';

type TemplateFilter = 'all' | 'image' | 'video';
const TEMPLATE_FILTERS: TemplateFilter[] = ['all', 'image', 'video'];

type CreationTemplatesProps = {
  onUseTemplate: (prompt: string, template: CreationTemplate) => void;
};

const CreationTemplates: React.FC<CreationTemplatesProps> = ({ onUseTemplate }) => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<TemplateFilter>('all');
  const wallRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = wallRef.current;
    if (!element) return;
    const update = () => {
      setWidth(element.clientWidth);
      setNarrow(window.innerWidth <= 560);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  const templates = CREATION_TEMPLATES.filter((template) => filter === 'all' || template.kind === filter);
  const masonry = creationMasonry(
    width,
    templates.map((template) => template.ratio),
    narrow
  );
  return (
    <section className={styles.creationTemplates} aria-labelledby='creation-templates-title'>
      <div className={styles.creationTemplateToolbar}>
        <div className='order-2'>
          <h2 id='creation-templates-title' className='sr-only'>
            {t('guid.templateTitle')}
          </h2>
          <p className='m-0 text-12px text-t-secondary'>{t('guid.templateHint')}</p>
        </div>
        <div className='flex gap-4px' role='group' aria-label={t('guid.templateFilterLabel')}>
          {TEMPLATE_FILTERS.map((kind) => (
            <Button
              key={kind}
              type={filter === kind ? 'secondary' : 'text'}
              size='small'
              aria-pressed={filter === kind}
              onClick={() => setFilter(kind)}
            >
              {t(`guid.templateFilters.${kind}`)}
            </Button>
          ))}
        </div>
      </div>
      <div
        ref={wallRef}
        className={styles.creationTemplateGrid}
        style={width ? { display: 'block', height: masonry.height } : undefined}
      >
        {templates.map((template, index) => (
          <CreationTemplateCard
            key={template.key}
            template={template}
            onUseTemplate={onUseTemplate}
            style={width ? { position: 'absolute', ...masonry.items[index] } : undefined}
          />
        ))}
      </div>
    </section>
  );
};

export default CreationTemplates;
