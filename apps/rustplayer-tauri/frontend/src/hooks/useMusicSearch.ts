import { useEffect, useRef, useState } from 'react';
import { ipc, type MusicSource } from '@/lib/ipc';
import type { Track } from '@/store/playerStore';
import { sanitizeError } from '@/lib/errorMessages';

export type SearchSource = 'all' | MusicSource;
export const searchSourceNames: Record<SearchSource, string> = {
  all: '全部音源', netease: '网易云', qqmusic: 'QQ音乐',
};

interface SearchTarget { query: string; source: SearchSource }
interface SearchResult extends SearchTarget { tracks: Track[]; revision: number }
type SearchState =
  | { phase: 'idle'; result: null }
  | { phase: 'waiting' | 'loading' | 'success'; target: SearchTarget; result: SearchResult | null }
  | { phase: 'error'; target: SearchTarget; result: SearchResult | null; message: string };

export function useMusicSearch() {
  const [input, setInput] = useState({ query: '', source: 'all' as SearchSource, composing: false, immediate: false, revision: 0 });
  const [state, setState] = useState<SearchState>({ phase: 'idle', result: null });
  const generation = useRef(0);

  const change = (patch: Partial<typeof input>) => {
    // Invalidate in the input event, including the interval before the next effect.
    generation.current += 1;
    setInput(previous => ({ ...previous, immediate: false, ...patch, revision: previous.revision + 1 }));
  };

  useEffect(() => {
    const query = input.query.trim();
    if (!query) { setState({ phase: 'idle', result: null }); return; }
    const target = { query, source: input.source };
    const revision = generation.current;
    let active = true;
    setState(previous => ({ phase: 'waiting', target, result: previous.result }));
    if (input.composing) return;

    const timer = setTimeout(async () => {
      setState(previous => ({ phase: 'loading', target, result: previous.result }));
      try {
        const tracks = await ipc.searchMusic(query, target.source === 'all' ? undefined : target.source);
        if (active && revision === generation.current) {
          setState({ phase: 'success', target, result: { ...target, tracks, revision: input.revision } });
        }
      } catch (error) {
        if (active && revision === generation.current) {
          setState(previous => ({ phase: 'error', target, result: previous.result, message: sanitizeError(error) }));
        }
      }
    }, input.immediate ? 0 : 450);
    return () => { active = false; clearTimeout(timer); };
  }, [input]);

  return {
    query: input.query, source: input.source, state,
    setQuery: (query: string) => change({ query }),
    setSource: (source: SearchSource) => change({ source, immediate: true }),
    submit: () => { if (!input.composing) change({ immediate: true }); },
    beginComposition: () => change({ composing: true }),
    endComposition: (query: string) => change({ query, composing: false }),
  };
}
