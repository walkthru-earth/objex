/**
 * Shared loader for the `colormaps.png` sprite shipped by
 * `@developmentseed/deck.gl-raster`. Decodes the sprite once per session and
 * uploads it to the GPU once per `Device`, so every COG / mosaic / multicog
 * viewer that renders a single-band colormap shares the same 2D-array
 * texture.
 *
 * The sprite is ~16 KB. Decode is fire-and-forget on first touch and caches
 * the resulting `ImageData` for the life of the tab; texture upload runs
 * synchronously once the device is known. Switching color ramps becomes a
 * uniform update (`colormapIndex`) rather than a texture rebind.
 */

import {
	COLORMAP_INDEX,
	type ColormapName,
	createColormapTexture,
	decodeColormapSprite
} from '@developmentseed/deck.gl-raster/gpu-modules';
// The `?url` suffix makes Vite emit the PNG as a fingerprinted asset and
// hand us back a string URL. Bundlers like Rollup/webpack behave the same
// for this pattern; the build define in `vite.config.ts` already copies the
// PNG into the production bundle.
import colormapsPngUrl from '@developmentseed/deck.gl-raster/gpu-modules/colormaps.png?url';
import type { Device, Texture } from '@luma.gl/core';

export { COLORMAP_INDEX, type ColormapName } from '@developmentseed/deck.gl-raster/gpu-modules';

/** URL of the shipped sprite, consumable as a CSS `background-image`. */
export const COLORMAP_SPRITE_URL = colormapsPngUrl;

/** Number of distinct ramps encoded as 1-pixel-tall rows in the sprite. */
export const COLORMAP_SPRITE_LAYERS = Object.keys(COLORMAP_INDEX).length;

/** All ramp names, sorted alphabetically (matches `COLORMAP_INDEX` key order). */
export const COLORMAP_NAMES = Object.keys(COLORMAP_INDEX).sort() as ColormapName[];

let spritePromise: Promise<ImageData> | null = null;
const textureCache = new WeakMap<Device, Texture>();

/** Decode the shipped sprite once per session. Safe to call repeatedly. */
export function loadColormapSprite(): Promise<ImageData> {
	if (!spritePromise) {
		spritePromise = (async () => {
			const res = await fetch(colormapsPngUrl);
			if (!res.ok) {
				throw new Error(`Failed to fetch colormaps.png: ${res.status}`);
			}
			const bytes = await res.arrayBuffer();
			return decodeColormapSprite(bytes);
		})();
	}
	return spritePromise;
}

/**
 * Get (or lazily build) the `sampler2DArray` colormap texture for a given
 * device. Returns the same `Texture` on subsequent calls for the same device
 * so it can be passed directly as the `colormapTexture` prop of the
 * `Colormap` shader module.
 */
export async function getColormapTexture(device: Device): Promise<Texture> {
	const cached = textureCache.get(device);
	if (cached) return cached;
	const imageData = await loadColormapSprite();
	const texture = createColormapTexture(device, imageData);
	textureCache.set(device, texture);
	return texture;
}
