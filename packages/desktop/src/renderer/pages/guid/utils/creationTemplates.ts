import poster from '@/renderer/assets/creation/images/poster.webp?url';
import product from '@/renderer/assets/creation/images/product.webp?url';
import architecture from '@/renderer/assets/creation/images/architecture.webp?url';
import landscape from '@/renderer/assets/creation/images/landscape.webp?url';
import pet from '@/renderer/assets/creation/images/pet.webp?url';
import food from '@/renderer/assets/creation/images/food.webp?url';
import interior from '@/renderer/assets/creation/images/interior.webp?url';
import flowers from '@/renderer/assets/creation/images/flowers.webp?url';
import coastPoster from '@/renderer/assets/creation/previews/coast.webp?url';
import coffeePoster from '@/renderer/assets/creation/previews/coffee-film.webp?url';
import cityPoster from '@/renderer/assets/creation/previews/city-film.webp?url';
import forestPoster from '@/renderer/assets/creation/previews/forest-film.webp?url';
import coastVideo from '@/renderer/assets/creation/videos/coast.mp4?url';
import coffeeVideo from '@/renderer/assets/creation/videos/coffee-film.mp4?url';
import cityVideo from '@/renderer/assets/creation/videos/city-film.mp4?url';
import forestVideo from '@/renderer/assets/creation/videos/forest-film.mp4?url';
import { CURATED_CREATION_TEMPLATES } from './curatedCreationTemplates';

export type CreationTemplateKey =
  | 'poster'
  | 'product'
  | 'architecture'
  | 'landscape'
  | 'pet'
  | 'food'
  | 'interior'
  | 'flowers'
  | 'coast'
  | 'coffeeFilm'
  | 'cityFilm'
  | 'forestFilm'
  | (typeof CURATED_CREATION_TEMPLATES)[number]['key'];

export type CreationTemplate = {
  key: CreationTemplateKey;
  cover: string;
  ratio: '3:4' | '4:3' | '16:9' | '2:3' | '6:7';
  requiresReference?: boolean;
} & ({ kind: 'image' } | { kind: 'video'; src: string; duration: number });

export const CREATION_TEMPLATES: readonly CreationTemplate[] = [
  ...CURATED_CREATION_TEMPLATES.slice(0, 6),
  { key: 'poster', kind: 'image', cover: poster, ratio: '3:4' },
  { key: 'coast', kind: 'video', cover: coastPoster, src: coastVideo, duration: 6, ratio: '16:9' },
  { key: 'product', kind: 'image', cover: product, ratio: '3:4' },
  { key: 'pet', kind: 'image', cover: pet, ratio: '3:4' },
  { key: 'coffeeFilm', kind: 'video', cover: coffeePoster, src: coffeeVideo, duration: 6, ratio: '16:9' },
  { key: 'architecture', kind: 'image', cover: architecture, ratio: '3:4' },
  { key: 'landscape', kind: 'image', cover: landscape, ratio: '16:9' },
  { key: 'cityFilm', kind: 'video', cover: cityPoster, src: cityVideo, duration: 6, ratio: '16:9' },
  { key: 'food', kind: 'image', cover: food, ratio: '4:3' },
  { key: 'interior', kind: 'image', cover: interior, ratio: '16:9' },
  { key: 'forestFilm', kind: 'video', cover: forestPoster, src: forestVideo, duration: 6, ratio: '16:9' },
  { key: 'flowers', kind: 'image', cover: flowers, ratio: '3:4' },
  ...CURATED_CREATION_TEMPLATES.slice(6),
];
