# ColorMap Tag Auto-Render Investigation

## (a) Does the library auto-render palette-indexed uint8 COGs via the ColorMap tag?

Yes. `@developmentseed/deck.gl-geotiff` v0.5's `inferRenderPipeline`
(`dist/geotiff/render-pipeline.js`) handles `SampleFormat.Uint` in
`createUnormPipeline`, which calls `photometricInterpretationToRGB`.
When `photometric === Photometric.Palette` (value `3`) and `colorMap` is
present in `cachedTags`, it runs `parseColormap` from
`@developmentseed/geotiff` and inserts the `Colormap` GPU module with an
`rgba8unorm` palette texture. Cog-layer's `_parseGeoTIFF` (line 94) only
installs this default pipeline when BOTH `getTileData` and `renderTile`
props are unset. NLCD-style palette COGs render correctly with zero
wiring in that path.

## (b) Does our flow override the auto path?

Yes. `needsCustomPipelineForConfig` in `src/lib/utils/cog.ts` returns
`true` when `config.mode === 'single'` regardless of photometric tag.
For a palette uint8 COG, `defaultBandConfig(1, 1)` produces
`mode: 'single'`, so `CogViewer.buildAndAddLayer` attaches
`createConfigurableGetTileData` + `customRenderTile`. The library sees
user-provided props and skips `inferRenderPipeline` entirely. Our custom
reader ignores the `ColorMap` tag, reading the raw palette-index band
and applying a `viridis` ramp. Result, every palette uint8 COG renders
as a false color ramp instead of its embedded palette.

## (c) Minimum fix

Short-circuit `needsCustomPipelineForConfig` to return `false` for
palette-indexed uint8 when the config still matches the default, so the
library runs its native ColorMap pipeline. Once the user tweaks bands
or ramp, custom pipeline resumes. One-line guard added in
`src/lib/utils/cog.ts` using `cachedTags.photometric === 3` (Palette),
`cachedTags.colorMap` presence, and `isDefaultBandConfig`.
