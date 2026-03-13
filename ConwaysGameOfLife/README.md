# Conway's Game of Life

Interactive Conway simulator with pan/zoom, stats, and pattern import/export.

## CPU vs GPU

- Default mode uses **GPU simulation** via WebGL2 (`GPU: On`) for faster ticks on larger grids.
- If WebGL2 is unavailable, the app automatically falls back to CPU mode.
- You can toggle simulation backend at runtime with the `GPU: On/Off` button while keeping the same UI/controls.

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
- `GPU: On/Off`: switch between GPU simulation and CPU simulation (WebGL2 only)

## Export / Import

- `Export`: download current world as JSON.
- `Import`: load JSON world file.

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
- Import also supports legacy `grid` format files, standard `.rle` files, and Golly `.mc` (macrocell) files.

## Included sample patterns

- `Figures/blinker.json`
- `Figures/toad.json`
- `Figures/glider.json`
- `Figures/acorn.json`
- `Figures/r_pentomino.json`
- `Figures/diehard.json`
- `Figures/lwss.json`
- `Figures/pulsar.json`
- `Figures/gosper_glider_gun.json`
- `Figures/twin_glider_annihilation.json`
