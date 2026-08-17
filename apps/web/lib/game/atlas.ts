import { assetUrl } from "@/lib/site";

export type AtlasRect = { x: number; y: number; w: number; h: number };

export type AtlasFrame = {
  frame: AtlasRect;
  anchor: { x: number; y: number };
  category: string;
};

export type Atlas = {
  meta: {
    image: string;
    size: { w: number; h: number };
    logicalCanvas: { w: number; h: number };
  };
  frames: Record<string, AtlasFrame>;
  animations: Record<string, { frames: string[]; msPerFrame?: number }>;
};

export type LoadedAtlas = { data: Atlas; image: HTMLImageElement };

/**
 * Bumped whenever `public/assets/atlas-game.*` changes. GitHub Pages pins
 * `Cache-Control: max-age=600` and cannot be configured, so the version query is the
 * only cache key we control.
 */
export const ASSET_VERSION = "1";

/** The atlas is one image + one JSON: exactly one image decode per session (spec §8 A6). */
export const EXPECTED_FRAME_COUNT = 100;

const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`image failed: ${source}`));
    image.src = source;
  });

export const loadAtlas = async (): Promise<LoadedAtlas> => {
  const jsonUrl = `${assetUrl("/assets/atlas-game.json")}?v=${ASSET_VERSION}`;
  const imageUrl = `${assetUrl("/assets/atlas-game.png")}?v=${ASSET_VERSION}`;

  const [response, image] = await Promise.all([
    fetch(jsonUrl),
    loadImage(imageUrl),
  ]);
  if (!response.ok) throw new Error(`atlas json ${response.status}`);
  const data = (await response.json()) as Atlas;

  const frameCount = Object.keys(data.frames ?? {}).length;
  if (frameCount !== EXPECTED_FRAME_COUNT) {
    throw new Error(`atlas frame contract mismatch: ${frameCount}`);
  }
  return { data, image };
};
