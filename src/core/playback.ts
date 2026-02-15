import type { PlaybackState } from '../types';

export function createPlaybackState(speed = 1): PlaybackState {
  return {
    isPlaying: true,
    speed,
  };
}

export function playPlayback(state: PlaybackState): void {
  state.isPlaying = true;
}

export function pausePlayback(state: PlaybackState): void {
  state.isPlaying = false;
}

export function restartPlayback(state: PlaybackState): void {
  state.isPlaying = true;
}
