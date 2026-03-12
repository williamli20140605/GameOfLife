# Conway's Game of Life

Interactive Conway simulator with pan/zoom, stats, persistence, and pattern import/export.

## CPU vs GPU

- Current implementation runs simulation logic on the **CPU** (JavaScript grid updates in `JS/game.js`).
- Canvas rendering is 2D API; browser may use GPU acceleration for drawing, but the cell-rule computation is still CPU-bound.
- For this project size, CPU is usually fine. A GPU/WebGL version can be faster for very large grids, but adds more code complexity.

## Run

Open `JS/index.html` in your browser.

## Controls

- `W/A/S/D`: move camera
- `Arrow Left/Right`: zoom out/in
- `P`: reset camera and zoom
- `Space`: single step (when stopped or frozen)
- Mouse wheel or touchpad two-finger vertical scroll: zoom at cursor
- Left click/drag: draw living cells
- Middle click/drag: erase cells

## Save / Load / Export / Import

- `Save`: save current world to browser local storage
- `Load`: restore from browser local storage
- `Export`: download current world as JSON
- `Import`: load JSON world file

## Lightweight pattern format (v2)

To keep repository size small, sample patterns use a lightweight `cells` format instead of full 2D grid dumps.

```json
{
  "version": 2,
  "format": "cells",
  "name": "Pattern Name",
  "width": 500,
  "height": 500,
  "cells": [[x1, y1], [x2, y2]]
}
```

- `cells` contains only living cells.
- `width`/`height` describe source pattern bounds and are used for centered import.
- Import also supports legacy `grid` format files.

## Included sample patterns

- `JS/twin_glider_creators_x2.json`
- `JS/twin_glider_annihilation_x2.json`
- `JS/twin_glider_annihilation_x2_A.json`
- `JS/twin_glider_annihilation_x2_B.json`
- `JS/twin_glider_annihilation_x2_C.json`
