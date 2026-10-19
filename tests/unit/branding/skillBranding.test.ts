import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as display from '@/renderer/utils/model/assistantDisplay';

describe('OpenH3 skill presentation', () => {
  it('maps only known legacy built-in names without rewriting custom skill names', () => {
    const normalize = (display as Record<string, unknown>).normalizeSkillDisplayName;
    expect(normalize).toBeTypeOf('function');
    const label = normalize as (name: string) => string;
    expect(label('aionui-config')).toBe('openh3-config');
    expect(label('aionui-troubleshooting')).toBe('openh3-troubleshooting');
    expect(label('openh3-webui-setup')).toBe('openh3-webui-setup');
    expect(label('openh3-webui-public')).toBe('openh3-webui-public');
    expect(label('apiyi-image-generation')).toBe('apiyi-image-generation');
    expect(label('aionui-custom-notes')).toBe('aionui-custom-notes');
    expect(label('toString')).toBe('toString');
  });

  it('normalizes only product-owned skill descriptions', () => {
    expect(display.normalizeSkillDescription('aionui-config', 'Configure AionUi with aioncore CLI.')).toBe(
      'Configure OpenH3 with OpenH3 Core CLI.'
    );
    expect(display.normalizeSkillDescription('openh3-config', 'Configure AionUi.')).toBe('Configure OpenH3.');
    expect(display.normalizeSkillDescription('user-notes', 'Compare AionUi and OpenH3.')).toBe(
      'Compare AionUi and OpenH3.'
    );
    expect(display.normalizeSkillDescription('user-notes', undefined)).toBe('');
  });

  it('preserves a custom or extension skill even when its name matches a built-in alias', () => {
    expect(display.normalizeSkillDisplayName('aionui-config', 'custom')).toBe('aionui-config');
    expect(display.normalizeSkillDisplayName('aionui-config', 'extension')).toBe('aionui-config');
    expect(display.normalizeSkillDescription('aionui-config', 'AionUi research notes', 'custom')).toBe(
      'AionUi research notes'
    );
  });

  it('removes legacy backend branding from localized startup and MCP errors', () => {
    const root = path.resolve('packages/desktop/src/renderer/services/i18n/locales');
    for (const locale of fs.readdirSync(root)) {
      for (const module of ['common', 'settings']) {
        const filename = path.join(root, locale, `${module}.json`);
        if (!fs.existsSync(filename)) continue;
        expect(fs.readFileSync(filename, 'utf8'), `${locale}/${module}`).not.toMatch(/AionCore/);
      }
    }
  });
});
