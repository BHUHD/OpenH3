import { useMemo } from 'react';
import { useProvidersQuery } from './useModelProviderList';

const useConfigModelListWithImage = () => {
  const { data } = useProvidersQuery();

  const modelListWithImage = useMemo(() => {
    return (Array.isArray(data) ? data : []).map((platform) => {
      const nextPlatform = {
        ...platform,
        models: [...platform.models],
      };
      const platformLower = platform.platform?.toLowerCase() || '';
      const hasImageModel = nextPlatform.models.some((m) => {
        const name = m.toLowerCase();
        return name.includes('image') || name.includes('imagine');
      });

      // 根据不同平台确保有对应的图像模型
      if (nextPlatform.platform === 'gemini' && (!nextPlatform.base_url || nextPlatform.base_url.trim() === '')) {
        // Supplement the stable image model for native Google Gemini accounts.
        const hasGeminiImage = nextPlatform.models.some(
          (m) => m.includes('gemini') && (m.includes('image') || m.includes('imagine'))
        );
        if (!hasGeminiImage) {
          nextPlatform.models = nextPlatform.models.concat(['gemini-2.5-flash-image']);
        }
      } else if (
        nextPlatform.platform === 'OpenRouter' &&
        nextPlatform.base_url &&
        nextPlatform.base_url.includes('openrouter.ai')
      ) {
        // Supplement the stable image model on the official OpenRouter endpoint.
        const hasOpenRouterImage = nextPlatform.models.some((m) => m.includes('image') || m.includes('imagine'));
        if (!hasOpenRouterImage) {
          nextPlatform.models = nextPlatform.models.concat(['google/gemini-2.5-flash-image']);
        }
      } else if (platformLower.includes('antigravity') && !hasImageModel) {
        // AntigravityTools 平台：添加常用图像模型
        // AntigravityTools platform: add common image models
        nextPlatform.models = nextPlatform.models.concat(['gemini-3-pro-image-1x1']);
      }

      return nextPlatform;
    });
  }, [data]);

  return {
    modelListWithImage,
  };
};

export default useConfigModelListWithImage;
