import { create } from 'zustand';
import { ipc, type MusicSource } from '@/lib/ipc';
import { sanitizeError } from '@/lib/errorMessages';

type LoginStatus = Record<MusicSource, boolean>;
interface AccountStore {
  status: LoginStatus | null;
  refreshing: boolean;
  error: string | null;
  refresh(): Promise<void>;
  setLoggedIn(source: MusicSource, loggedIn: boolean): void;
}

export function createAccountStore(readStatus: () => Promise<LoginStatus>) {
  const versions: Record<MusicSource, number> = { netease: 0, qqmusic: 0 };
  return create<AccountStore>((set, get) => ({
    status: null,
    refreshing: false,
    error: null,
    refresh: async () => {
      if (get().refreshing) return;
      const started = { ...versions };
      // A background check keeps the last confirmed account facts available.
      set({ refreshing: true, error: null });
      try {
        const status = await readStatus();
        set(state => ({ status: {
          // Login/logout confirmations take precedence over an older snapshot,
          // while the same response can still update the other music source.
          netease: started.netease === versions.netease ? status.netease : state.status!.netease,
          qqmusic: started.qqmusic === versions.qqmusic ? status.qqmusic : state.status!.qqmusic,
        } }));
      } catch (error) {
        if (started.netease === versions.netease && started.qqmusic === versions.qqmusic) {
          set({ error: sanitizeError(error) });
        }
      } finally { set({ refreshing: false }); }
    },
    setLoggedIn: (source, loggedIn) => {
      versions[source] += 1;
      set(state => ({ status: { netease: false, qqmusic: false, ...state.status, [source]: loggedIn }, error: null }));
    },
  }));
}

export const useAccountStore = createAccountStore(ipc.checkLoginStatus);
