import { ipc } from '@/lib/ipc';
import { createPlaybackLifecycle } from '@/lib/playbackLifecycle';
import { saveSetting } from '@/lib/settings';
import { sanitizeError } from '@/lib/errorMessages';
import { notifyRadioDiscovery } from '@/lib/radioNotifications';
import { useToastStore } from '@/store/toastStore';

export type { Track, PlayMode } from '@/lib/playbackLifecycle';

export const usePlayerStore = createPlaybackLifecycle({
  engine: ipc,
  recordPlayEvent: ipc.recordPlayEvent,
  getRadioBatch: ipc.getRadioBatch,
  notifyDiscovery: notifyRadioDiscovery,
  notify: (type, message) => useToastStore.getState().addToast(type, message),
  errorMessage: sanitizeError,
  saveVolume: volume => saveSetting('volume', volume),
});
