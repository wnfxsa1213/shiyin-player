import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

const timerMap = new Map<string, ReturnType<typeof setTimeout>>();

interface ToastStore {
  toasts: Toast[];
  addToast: (type: ToastType, message: string) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
    set((state) => ({
      toasts: [...state.toasts, { id, type, message }].slice(-3),
    }));
    const timer = setTimeout(() => {
      timerMap.delete(id);
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 3000);
    timerMap.set(id, timer);
  },
  removeToast: (id) => {
    const timer = timerMap.get(id);
    if (timer) {
      clearTimeout(timer);
      timerMap.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
}));
