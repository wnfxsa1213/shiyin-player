import type { PlayerStore } from '@/lib/playbackLifecycle';
import type { PlayerSpectrum } from '@/lib/ipc';
import { spectrumDataRef } from '@/store/visualizerStore';

type PlaybackFacts = Pick<PlayerStore, 'state' | 'playbackId' | 'listening'>;

export function hasVisualPlayback(player: PlaybackFacts, visible = true): boolean {
  return visible && player.state === 'playing' && player.listening.state === 'playing'
    && player.playbackId !== null && player.playbackId === player.listening.playbackId;
}

export function receiveSpectrum(event: PlayerSpectrum, player: PlaybackFacts, visible: boolean) {
  if (!hasVisualPlayback(player, visible) || event.playbackId !== player.listening.playbackId
    || Date.now() - event.emittedAtMs > 1000) return;
  const values = spectrumDataRef.current;
  const length = Math.min(event.magnitudes.length, values.length);
  for (let index = 0; index < length; index++) values[index] = event.magnitudes[index];
  values.fill(0, length);
  spectrumDataRef.receivedAt = performance.now();
  spectrumDataRef.playbackId = event.playbackId;
}
