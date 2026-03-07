import { create } from 'zustand';
import { saveSetting } from '@/lib/settings';

interface UiStore {
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  immersiveOpen: boolean;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setImmersiveOpen: (v: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  theme: 'dark',
  sidebarCollapsed: false,
  immersiveOpen: false,
  toggleTheme: () => set((s) => {
    const newTheme = s.theme === 'dark' ? 'light' : 'dark';
    saveSetting('theme', newTheme).catch(console.error);
    return { theme: newTheme };
  }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setImmersiveOpen: (immersiveOpen) => set({ immersiveOpen }),
}));
