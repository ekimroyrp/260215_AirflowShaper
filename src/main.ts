import './style.css';
import { createAirflowShaperApp } from './app/createAirflowShaperApp';

const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
if (!canvas) {
  throw new Error('Canvas element #app-canvas was not found.');
}

const app = createAirflowShaperApp(canvas);

// Exposed for debugging in the browser console.
Object.assign(window, { airflowShaperApp: app });
