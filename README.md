# 260215_AirflowShaper

260215_AirflowShaper is a Three.js airflow simulator prototype with a transformable emitter plane, multiple obstacle mesh types, and a real-time hybrid flow model (base flow + obstacle deflection + impact turbulence + lane recovery) rendered as either crisp particles/trails or a blur-flow smoke-like view.

## Features
- Vite + TypeScript + Three.js app scaffold.
- Emitter plane with transform gizmo support (move/rotate/scale) and adjustable vertex density (`Density X`, `Density Y`).
- Continuous particle respawn from emitter vertices with stable flow-length behavior independent of emitter density.
- Obstacle creation tools for `Add Plane`, `Add Box`, `Add Sphere`, `Add Pyramid`, and `Add Torus`.
- Shape-aware obstacle interaction with non-penetration, surface sliding, wake behavior, and non-uniform scale handling.
- Impact-driven turbulence: turbulence is applied from impact onward and fades through `Impact Recovery`.
- Flow shaping controls for `Flow Speed`, `Flow Length`, `Impact Recovery`, `Impact Buffer`, and `Impact Turbulance`.
- Color mapping from `Flow Color` to `Impact Color` based on each particle's off-lane deviation.
- Dual display modes: standard particle/trail rendering or `Blur Flow` smoke-like display.
- Obstacle deletion keeps selection cleared instead of auto-selecting the emitter.
- Orbit/transform interaction model aligned with `260208_SoapFilm`.
- Vitest suite for emitter, flow field, playback, obstacle interaction, and trail reset logic.

## Getting Started
1. `npm install`
2. `npm run dev`
3. Open the local Vite URL shown in terminal (default `http://localhost:5173`)
4. Optional checks:
   - `npm run test`
   - `npm run build`
   - `npm run preview`

## Controls
- UI Panel:
  - `Simulation`: `Play`, `Pause`, `Restart`
  - `Display`: `Blur Flow`, `Flow Color`, `Impact Color`
  - `Emitter`: `Density X`, `Density Y`
  - `Flow`: `Flow Speed`, `Flow Length`, `Impact Recovery`, `Impact Buffer`, `Impact Turbulance`
  - `Obstacles`: `Add Plane`, `Add Box`, `Add Sphere`, `Add Pyramid`, `Add Torus`
- Mouse:
  - Left-click selects emitter/obstacle mesh
  - Drag transform gizmo handles to move/rotate/scale selected plane
  - Middle mouse pans camera
  - Right mouse rotates camera
  - Mouse wheel zooms
- Keyboard:
  - `Delete` removes selected obstacle
  - `Escape` clears selection

## V1 Validation Checklist
- Change `Density X`/`Density Y` and confirm emitter spawn lanes get denser/sparser without changing effective flow length.
- Rotate emitter and confirm flow direction follows emitter normal.
- Use `Play`, `Pause`, and `Restart` to control simulation state.
- Add multiple obstacle shapes and verify particles bend/slide around their surfaces.
- Set `Impact Turbulance` above zero and verify turbulence appears after impact and fades with `Impact Recovery`.
- Toggle `Blur Flow` and confirm rendering switches between particle/trails and smoke-like display.
- Use `Restart` and verify old trails clear and new trails start from emitter.

## Deployment
- **Local production preview:** `npm install`, then `npm run build` followed by `npm run preview` to inspect the compiled bundle.
- **Publish to GitHub Pages:** From a clean `main`, run `npm run build -- --base ./`. Checkout (or create) the `gh-pages` branch in a separate worktree/temp clone, copy everything inside `dist/` plus a `.nojekyll` marker to the branch root (and keep minimal static structure such as `assets/`, optional `env/`, `index.html`, and `.gitignore`), commit with a descriptive message, `git push origin gh-pages`, then switch back to `main`.
- **Live demo:** https://ekimroyrp.github.io/260215_AirflowShaper/
