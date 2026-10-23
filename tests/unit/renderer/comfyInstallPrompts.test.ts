import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { comfyFamilyRecipeKey } from '@/renderer/pages/guid/Creation/comfyDraft';

const localeRoot = path.resolve('packages/desktop/src/renderer/services/i18n/locales');

describe('ComfyUI install prompts', () => {
  it('provides each new image card with a localized, hardware-aware recipe for every install action', () => {
    const families = ['flux-3-image-klein', 'moss-image-base', 'moss-image-sft', 'krea2'] as const;
    for (const locale of fs.readdirSync(localeRoot)) {
      const file = path.join(localeRoot, locale, 'guid.json');
      if (!fs.existsSync(file)) continue;
      const { comfy } = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        comfy: { families: Record<string, string>; recipes: Record<string, string>; imageRecipeRequirements: string };
      };
      for (const family of families) {
        expect(comfyFamilyRecipeKey(family)).toBe(`guid.comfy.recipes.${family}`);
        expect(comfy.families[family]?.length, `${locale} ${family}`).toBeGreaterThan(1);
        expect(comfy.recipes?.[family], `${locale} ${family}`).toContain('comfyui-local');
        expect(comfy.recipes?.[family], `${locale} ${family}`).toContain(`references/z-image.md#${family}`);
        expect(comfy.recipes?.[family], `${locale} ${family}`).toContain('BF16');
        expect(comfy.recipes?.[family], `${locale} ${family}`).toContain('INT8-ConvRot');
      }
      expect(comfy.recipes['flux-3-image-klein']).toContain('steps=16');
      expect(comfy.recipes['moss-image-base']).toContain('moss_image');
      expect(comfy.recipes['moss-image-sft']).toContain('moss_image');
      expect(comfy.recipes['moss-image-sft']).toContain('SFT');
      expect(comfy.recipes.krea2).toContain('steps=8');
      for (const token of ['ModelScope', 'SHA-256', 'openh3_comfy_environment', 'NVFP4', 'Blackwell']) {
        expect(comfy.imageRecipeRequirements, `${locale} ${token}`).toContain(token);
      }
    }
  });

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

  it('routes Omni installation and repair to its pinned multimodal recipe in every locale', () => {
    const locales = fs
      .readdirSync(localeRoot)
      .filter((name) => fs.existsSync(path.join(localeRoot, name, 'guid.json')));
    for (const locale of locales) {
      const document = JSON.parse(fs.readFileSync(path.join(localeRoot, locale, 'guid.json'), 'utf8')) as {
        comfy: { prompts: Record<'install' | 'repair' | 'install-other', string> };
      };
      for (const key of ['install', 'repair', 'install-other'] as const) {
        const prompt = document.comfy.prompts[key];
        const label = `${locale} ${key}`;
        expect(prompt, label).toContain('FastH3-Omni');
        expect(prompt, label).toContain('comfyui-local');
        expect(prompt, label).toContain('references/fasth3-omni.md');
        expect(prompt, label).toContain('FastVideo/FastH3-Omni-Comfy');
        for (const token of ['BF16', 'INT8-ConvRot', 'FP8', 'NVFP4-QAD', 'Blackwell', 'R2V', 'steps=8', 'guidance=1']) {
          expect(prompt, `${label} ${token}`).toContain(token);
        }
        expect(prompt, label).toContain('shift=12/3');
        expect(prompt, label).toContain('Turbo LoRA');
        // Preserve real reference/audio requirements and distinguish missing hardware from missing probe evidence.
        expect(prompt, label).toMatch(
          /至少一张图片或一段视频|至少一張圖片或一段影片|at least one image or video|mindestens ein Bild oder Video|al menos una imagen o un vídeo|حداقل یک تصویر یا ویدئو|au moins une image ou une vidéo|画像または動画が少なくとも1つ|이미지 또는 동영상이 최소 1개|pelo menos uma imagem ou um vídeo|хотя бы одно изображение или видео|en az bir görüntü veya video|хоча б одне зображення або відео/
        );
        expect(prompt, label).toMatch(
          /设备条件不足|設備條件不足|device requirements not met|Geräteanforderungen nicht erfüllt|requisitos del dispositivo no cumplidos|شرایط دستگاه کافی نیست|conditions matérielles insuffisantes|デバイス要件不足|기기 조건 부족|requisitos do dispositivo não atendidos|устройство не соответствует требованиям|cihaz gereksinimleri karşılanmıyor|пристрій не відповідає вимогам/
        );
        expect(prompt, label).toMatch(
          /检测未完成|偵測未完成|detection incomplete|Erkennung unvollständig|detección incompleta|تشخیص کامل نشده|détection incomplète|検出未完了|감지 미완료|detecção incompleta|проверка не завершена|tespit tamamlanmadı|перевірку не завершено/
        );
        expect(prompt, label).toMatch(
          /音轨|音軌|audio track|Audiospur|pista de audio|ترک صوت|piste audio|音声トラック|오디오 트랙|faixa de áudio|аудиодорожки|ses parçası|аудіодоріжки/
        );
      }
    }
  });

  it('keeps OOM repair retries on the original input and restores uncertain work before resubmission', () => {
    const repairPhrases: Record<string, [string, string, string]> = {
      'zh-CN': ['最多重试一次', '原模型、原参考和原参数', '先恢复已有任务'],
      'zh-TW': ['最多重試一次', '原模型、原參考與原參數', '先恢復既有任務'],
      'en-US': ['retry at most once', 'original model, references, and parameters', 'restore the existing job first'],
      'de-DE': [
        'höchstens einmal',
        'ursprünglichen Modell, Referenzen und Parametern',
        'zuerst den bestehenden Auftrag wiederherstellen',
      ],
      'es-ES': [
        'como máximo una vez',
        'modelo, referencias y parámetros originales',
        'recupera primero el trabajo existente',
      ],
      'fa-IR': ['حداکثر یک بار', 'مدل، مرجع‌ها و پارامترهای اصلی', 'ابتدا کار موجود را بازیابی کن'],
      'fr-FR': [
        'au maximum une fois',
        'modèle, les références et les paramètres d’origine',
        'rétablis d’abord la tâche existante',
      ],
      'ja-JP': ['最大1回だけ再試行', '元のモデル・参照・パラメーター', '既存ジョブを先に復元'],
      'ko-KR': ['최대 1회만 재시도', '원래 모델, 참조 및 매개변수', '기존 작업을 먼저 복구'],
      'pt-BR': [
        'no máximo uma vez',
        'modelo, referências e parâmetros originais',
        'restaure primeiro o trabalho existente',
      ],
      'ru-RU': [
        'не более одного раза',
        'исходными моделью, референсами и параметрами',
        'сначала восстанови существующее задание',
      ],
      'tr-TR': ['en fazla bir kez', 'özgün model, referanslar ve parametrelerle', 'önce mevcut işi geri yükle'],
      'uk-UA': [
        'не більше одного разу',
        'початковими моделлю, референсами й параметрами',
        'спочатку віднови наявне завдання',
      ],
    };
    for (const [locale, phrases] of Object.entries(repairPhrases)) {
      const document = JSON.parse(fs.readFileSync(path.join(localeRoot, locale, 'guid.json'), 'utf8')) as {
        comfy: { prompts: { repair: string } };
      };
      const prompt = document.comfy.prompts.repair;
      expect(prompt, locale).toContain('OOM');
      expect(prompt, locale).toContain('/free');
      for (const phrase of phrases) expect(prompt, locale).toContain(phrase);
      expect(prompt, locale).not.toMatch(
        /显存不足先按该方案允许的分辨率|lower width\/height|lower (?:the )?resolution/i
      );
    }
  });
});
