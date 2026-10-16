import React, { useState } from 'react';
import { Button, Dropdown, Menu } from '@arco-design/web-react';
import { Down, Magic } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type {
  CreationKind,
  CreationModel,
  CreationSelection,
  CreationSource,
} from '@/common/chat/document/creation/creation';
import styles from './creation.module.css';

type Props = {
  selection: CreationSelection;
  models: CreationModel[];
  model: CreationModel;
  onChange: React.Dispatch<React.SetStateAction<CreationSelection>>;
  onManageLocal: (model: CreationModel) => void;
};

export default function CreationControls({ selection, models, model, onChange, onManageLocal }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const modelName = (item: CreationModel) =>
    item.name || t(`guid.creation.${item.source}${item.kind === 'image' ? 'Image' : 'Video'}`);
  return (
    <>
      <div className={styles.segment} role='group' aria-label={t('guid.creation.kind')}>
        {(['image', 'video'] as CreationKind[]).map((kind) => (
          <Button
            key={kind}
            type='text'
            size='small'
            aria-pressed={selection.kind === kind}
            className={selection.kind === kind ? styles.selected : undefined}
            onClick={() => onChange((previous) => ({ ...previous, kind }))}
          >
            {t(`guid.templateFilters.${kind}`)}
          </Button>
        ))}
      </div>
      <div className={styles.segment} role='group' aria-label={t('guid.creation.source')}>
        {(['local', 'cloud'] as CreationSource[]).map((source) => (
          <Button
            key={source}
            type='text'
            size='small'
            aria-pressed={selection.source === source}
            className={selection.source === source ? styles.selected : undefined}
            onClick={() => onChange((previous) => ({ ...previous, source }))}
          >
            {t(`guid.creation.${source}`)}
          </Button>
        ))}
      </div>
      <Dropdown
        trigger='click'
        popupVisible={open}
        onVisibleChange={setOpen}
        triggerProps={{ autoAlignPopupWidth: true }}
        droplist={
          <Menu className={styles.menu}>
            {models.map((item) => (
              <Menu.Item
                key={item.id}
                disabled={item.source === 'cloud' && !item.available}
                onClick={() => {
                  onChange((previous) => ({
                    ...previous,
                    modelIds: { ...previous.modelIds, [`${selection.source}-${selection.kind}`]: item.id },
                  }));
                  setOpen(false);
                  if (item.source === 'local' && !item.available) onManageLocal(item);
                }}
              >
                <span className={styles.modelName}>{modelName(item)}</span>
                <span className={styles.state}>{t(`guid.creation.states.${item.state}`)}</span>
              </Menu.Item>
            ))}
            <Menu.Item
              key='manage'
              onClick={() => {
                setOpen(false);
                if (selection.source === 'local') onManageLocal(model);
                else navigate('/settings/tools');
              }}
            >
              {t(selection.source === 'local' ? 'guid.creation.manageLocal' : 'guid.creation.configureCloud')}
            </Menu.Item>
          </Menu>
        }
      >
        <Button
          type='text'
          size='small'
          className={styles.modelTrigger}
          aria-label={t('guid.creation.model')}
          data-testid='creation-model-selector'
          aria-expanded={open}
        >
          <Magic theme='outline' size='14' />
          <span className={styles.modelName}>{modelName(model)}</span>
          <span className={styles.state}>{t(`guid.creation.states.${model.state}`)}</span>
          <Down theme='outline' size='14' strokeWidth={4} className={open ? styles.arrowOpen : styles.arrow} />
        </Button>
      </Dropdown>
    </>
  );
}
