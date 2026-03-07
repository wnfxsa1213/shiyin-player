import { memo } from 'react';
import { useVisualizerStore, type VisualizationMode } from '@/store/visualizerStore';
import { BarChart3, Circle, Activity } from 'lucide-react';

const MODES: { mode: VisualizationMode; icon: typeof BarChart3; label: string }[] = [
  { mode: 'bars', icon: BarChart3, label: '柱状' },
  { mode: 'circle', icon: Circle, label: '环形' },
  { mode: 'wave', icon: Activity, label: '波形' },
];

export default memo(function VizModeSwitcher() {
  const current = useVisualizerStore((s) => s.visualizationMode);
  const setMode = useVisualizerStore((s) => s.setVisualizationMode);

  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-full p-1">
      {MODES.map(({ mode, icon: Icon, label }) => {
        const active = current === mode;
        return (
          <button
            key={mode}
            onClick={() => setMode(mode)}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              active
                ? 'bg-white/20 text-white'
                : 'text-white/50 hover:text-white/80'
            }`}
            aria-label={`${label}模式`}
            aria-pressed={active}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
});
