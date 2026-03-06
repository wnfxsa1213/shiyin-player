import { create } from 'zustand';
import { saveSetting } from '@/lib/settings';

export interface ColorPreset {
  name: string;
  primary: string;
  secondary: string;
  particle: string;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { name: 'ocean', primary: '#A78BFA', secondary: '#38BDF8', particle: '#34D399' },
  { name: 'sunset', primary: '#F97316', secondary: '#FBBF24', particle: '#F87171' },
  { name: 'aurora', primary: '#34D399', secondary: '#06B6D4', particle: '#A78BFA' },
  { name: 'neon', primary: '#D946EF', secondary: '#EC4899', particle: '#FBBF24' },
  { name: 'mono', primary: '#F1F3F9', secondary: '#A1A8C1', particle: '#6B7280' },
];

/**
 * Shared mutable ref for spectrum magnitude data.
 * Written by the IPC spectrum event callback, read by SpectrumVisualizer's RAF loop.
 * Bypasses Zustand entirely to avoid triggering ~15fps store updates and React re-renders.
 */
export const spectrumDataRef = { current: new Float32Array(64) };

interface VisualizerStore {
  enabled: boolean;
  showParticles: boolean;
  colors: { primary: string; secondary: string; particle: string };
  setEnabled: (v: boolean) => void;
  setShowParticles: (v: boolean) => void;
  setColors: (c: { primary: string; secondary: string; particle: string }) => void;
  applyPreset: (name: string) => void;
}

export const useVisualizerStore = create<VisualizerStore>((set) => ({
  enabled: true,
  showParticles: true,
  colors: COLOR_PRESETS[0],
  setEnabled: (enabled) => {
    set({ enabled });
    saveSetting('visualizer.enabled', enabled).catch(console.error);
  },
  setShowParticles: (showParticles) => {
    set({ showParticles });
    saveSetting('visualizer.showParticles', showParticles).catch(console.error);
  },
  setColors: (colors) => {
    set({ colors });
    saveSetting('visualizer.colors', colors).catch(console.error);
  },
  applyPreset: (name) => {
    const preset = COLOR_PRESETS.find((p) => p.name === name);
    if (preset) {
      const colors = { primary: preset.primary, secondary: preset.secondary, particle: preset.particle };
      set({ colors });
      saveSetting('visualizer.colors', colors).catch(console.error);
    }
  },
}));
