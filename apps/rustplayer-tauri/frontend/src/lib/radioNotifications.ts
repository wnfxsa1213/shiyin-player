import type { MusicDiscoveryStatus } from '@/lib/ipc';
import { useToastStore } from '@/store/toastStore';

let reportedAvailableSources = '';

/** Share one degradation notice across FM playback and automatic queue replenishment. */
export function notifyRadioDiscovery(discovery: MusicDiscoveryStatus): void {
  if (discovery.outcome === 'complete' || discovery.outcome === 'empty') {
    reportedAvailableSources = '';
    return;
  }
  if (discovery.outcome !== 'degraded' || discovery.availableSources.length === 0) return;

  const sources = [...discovery.availableSources].sort();
  const sourceKey = sources.join(',');
  if (sourceKey === reportedAvailableSources) return;

  reportedAvailableSources = sourceKey;
  const names = sources.map(source => source === 'netease' ? '网易云音乐' : 'QQ音乐').join(' / ');
  useToastStore.getState().addToast('info', `部分音源暂不可用，当前来自：${names}`);
}
