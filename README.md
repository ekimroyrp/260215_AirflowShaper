# 260215_AirflowShaper

260215_AirflowShaper is a Three.js airflow particle simulator prototype with a transformable emitter plane, editable obstacle planes, and a real-time hybrid flow model (base flow + obstacle deflection + turbulence wake) rendered with particle trails.

## Features
- Vite + TypeScript + Three.js app scaffold.
- Emitter plane with transform gizmo support (move/rotate/scale).
- Adjustable emitter vertex density (`Density X`, `Density Y`) driving spawn vertices.
- Continuous particle respawn from emitter plane vertices.
- Particle trails rendered in real time.
- Add unlimited obstacle planes via `Add Plane`.
- Obstacle interaction with slide and wake turbulence behavior.
- Play, pause, restart controls and flow speed/turbulence sliders.
- Orbit/transform interaction model aligned with `260208_SoapFilm`.
- Vitest suite for emitter, flow field, playback, obstacle interaction, and trail reset logic.

## Getting Started
1. `npm install`
2. `npm run dev`
3. Open the local Vite URL shown in terminal (default `http://127.0.0.1:6215`)
4. Optional checks:
   - `npm run test`
   - `npm run build`

## Controls
- UI Panel:
  - `Play`
  - `Pause`
  - `Restart`
  - `Flow Speed`
  - `Turbulence`
  - `Density X`
  - `Density Y`
  - `Add Plane`
- Mouse:
  - Left-click selects emitter/obstacle plane
  - Drag transform gizmo handles to move/rotate/scale selected plane
  - Middle mouse pans camera
  - Right mouse rotates camera
  - Mouse wheel zooms
- Keyboard:
  - `Delete` removes selected obstacle plane
  - `Escape` clears selection

## V1 Validation Checklist
- Change `Density X`/`Density Y` and confirm emitter vertex count and stream density change.
- Rotate emitter and confirm flow direction follows emitter normal.
- Use `Play`, `Pause`, and `Restart` to control simulation state.
- Add multiple obstacle planes and verify particles bend/slide around them.
- Place obstacles downstream and verify wake turbulence appears behind them.
- Use `Restart` and verify old trails clear and new trails start from emitter.
