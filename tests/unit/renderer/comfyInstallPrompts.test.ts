import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const localeRoot = path.resolve('packages/desktop/src/renderer/services/i18n/locales');

describe('ComfyUI install prompts', () => {
  it('asks every locale to plan the matching workflow, components, and network-safe source', () => {
    const locales = fs
      .readdirSync(localeRoot)
      .filter((name) => fs.existsSync(path.join(localeRoot, name, 'guid.json')));
    expect(locales.length).toBeGreaterThanOrEqual(13);
    for (const locale of locales) {
      const document = JSON.parse(fs.readFileSync(path.join(localeRoot, locale, 'guid.json'), 'utf8')) as {
        comfy?: { prompts?: { install?: string; repair?: string; 'install-other'?: string } };
      };
      const prompt = document.comfy?.prompts?.install ?? '';
      const repair = document.comfy?.prompts?.repair ?? '';
      const installOther = document.comfy?.prompts?.['install-other'] ?? '';
      expect(prompt, locale).toMatch(/ComfyUI/i);
      expect(prompt, locale).toMatch(
        /workflow|工作流|工作流程|ワークフロー|워크플로|flujo|گردش.?کار|рабочий процесс|робочий процес|iş akışı/i
      );
      expect(prompt, locale).toMatch(/SHA-256|SHA256|sha-256/i);
      expect(prompt, locale).toMatch(/ModelScope|魔搭/i);
      expect(prompt, locale).toMatch(/openh3_comfy_environment/i);
      expect(prompt, locale).toMatch(/network\.requested|NETWORK_/i);
      expect(prompt, locale).toMatch(/12/);
      expect(prompt, locale).toMatch(/batch|分批|batching/i);
      expect(prompt, locale).toMatch(/reachability|可达性|同名.*(?:not enough|不够|不等于|不证明)/i);
      expect(prompt, locale).toMatch(/resume|断点|reanud|reprise|Fortsetzen|再開|재개|재개|재개/i);
      expect(repair, `${locale} repair`).toMatch(/openh3_comfy_environment/i);
      expect(repair, `${locale} repair`).toMatch(/NETWORK_|network\.requested/i);
      expect(repair, `${locale} repair`).toMatch(/12/);
      expect(repair, `${locale} repair`).toMatch(/batch|分批|batching/i);
      expect(repair, `${locale} repair`).toMatch(/reachability|可达性|同名.*(?:not enough|不够|不等于|不证明)/i);
      expect(installOther, `${locale} install-other`).toMatch(/openh3_comfy_environment/i);
      expect(installOther, `${locale} install-other`).toMatch(/network\.requested|NETWORK_/i);
      expect(installOther, `${locale} install-other`).toMatch(/SHA-256|SHA256|sha-256/i);
      expect(installOther, `${locale} install-other`).toMatch(/12/);
      expect(installOther, `${locale} install-other`).toMatch(/batch|分批|batching/i);
      expect(installOther, `${locale} install-other`).toMatch(
        /reachability|可达性|同名.*(?:not enough|不够|不等于|不证明)/i
      );
    }
  });

  it('makes the Chinese cards preserve each family task instead of silently swapping models', () => {
    const document = JSON.parse(fs.readFileSync(path.join(localeRoot, 'zh-CN', 'guid.json'), 'utf8')) as {
      comfy?: { prompts?: { install?: string; repair?: string; 'install-other'?: string } };
    };
    for (const key of ['install', 'repair', 'install-other'] as const) {
      const prompt = document.comfy?.prompts?.[key] ?? '';
      expect(prompt, key).toMatch(/H3.*文生(?:视频.*图生视频|\/图生视频)/s);
      expect(prompt, key).toMatch(/Z-Image.*文生图/s);
      expect(prompt, key).toMatch(/Qwen-Edit.*输入图片改图/s);
      if (key !== 'repair') expect(prompt, key).toMatch(/安装请求.*生成请求|只负责安装.*生成参数/s);
      expect(prompt, key).toMatch(/断点续传/);
      expect(prompt, key).toMatch(/network\.requested=false/);
      expect(prompt, key).toMatch(/最多.{0,8}12 个 URL/);
      expect(prompt, key).toMatch(/分批|逐批/);
      expect(prompt, key).toMatch(/可达性.*(?:不等于|不证明).*同一|同名.*(?:不等于|不证明).*同一|身份.*(?:摘要|证据)/);
      expect(prompt, key).toMatch(/分批(?:探测)?|逐批/);
    }
  });
});
