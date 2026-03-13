# GameOfLife

This repository contains the full Game of Life project, including browser apps for both Conway and HighLife.

## Apps

- `ConwaysGameOfLife` - Conway's Life (`B3/S23`)
- `HighLife` - HighLife (`B36/S23`)

Both web apps support:

- CPU and WebGL2 GPU simulation (`GPU: On/Off`)
- Activated-region optimization for large grids
- Pan/zoom, tick-rate control, grid-size control, and import/export

## Run

Open either entry page in your browser:

- `ConwaysGameOfLife/JS/index.html`
- `HighLife/JS/index.html`

## Repository Layout

- `ConwaysGameOfLife/Figures/` - Conway sample patterns
- `ConwaysGameOfLife/JS/` - Conway web app
- `ConwaysGameOfLife/Python/` - Python implementation
- `HighLife/Figures/` - HighLife sample patterns
- `HighLife/JS/` - HighLife web app
- `ConwaysGameOfLife.py` - legacy single-file script

## Notes

- `ConwaysGameOfLife/ImportedPatterns/` is intentionally excluded from git.
- Pattern JSON files use lightweight `cells` format where possible.
