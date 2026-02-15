import { describe, expect, it } from 'vitest';
import { createPlaybackState, pausePlayback, playPlayback, restartPlayback } from '../src/core/playback';

describe('playback', () => {
  it('supports play/pause transitions', () => {
    const state = createPlaybackState(1.2);
    expect(state.isPlaying).toBe(true);
    expect(state.speed).toBe(1.2);

    pausePlayback(state);
    expect(state.isPlaying).toBe(false);

    playPlayback(state);
    expect(state.isPlaying).toBe(true);
  });

  it('restart sets playing', () => {
    const state = createPlaybackState();
    pausePlayback(state);
    restartPlayback(state);
    expect(state.isPlaying).toBe(true);
  });
});
