import { useState, useEffect, useRef } from 'react';
import { ipc } from '@/lib/ipc';
import { Track } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import { sanitizeError } from '@/lib/errorMessages';
import VirtualTrackList from '@/components/common/VirtualTrackList';
import { Search, SearchX, Music } from 'lucide-react';

let searchSeq = 0;

export default function SearchView() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [source, setSource] = useState<'all' | 'netease' | 'qqmusic'>('all');
  const [debouncedSource, setDebouncedSource] = useState(source);
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 450);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSource(source), 200);
    return () => clearTimeout(t);
  }, [source]);

  useEffect(() => {
    const seq = ++searchSeq;
    if (!debouncedQuery.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    ipc.searchMusic(debouncedQuery, debouncedSource === 'all' ? undefined : debouncedSource)
      .then((r) => { if (seq === searchSeq) setResults(r); })
      .catch((err) => {
        if (seq === searchSeq) useToastStore.getState().addToast('error', `搜索失败: ${sanitizeError(err)}`);
      })
      .finally(() => { if (seq === searchSeq) setLoading(false); });
  }, [debouncedQuery, debouncedSource]);

  const tabs = ['all', 'netease', 'qqmusic'] as const;
  const panelId = 'search-source-panel';
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number) => {
    const nextIndex = (index + tabs.length) % tabs.length;
    setSource(tabs[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.indexOf(source);
    if (currentIndex === -1) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        focusTab(currentIndex - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusTab(currentIndex + 1);
        break;
      case 'Home':
        e.preventDefault();
        focusTab(0);
        break;
      case 'End':
        e.preventDefault();
        focusTab(tabs.length - 1);
        break;
    }
  };

  return (
    <div className="p-8 pb-28 flex flex-col h-full">
      <h1 className="text-3xl font-bold mb-6 animate-fade-in-up">搜索</h1>

      <div className="relative w-full max-w-xl mb-6 animate-fade-in-up [animation-delay:50ms]">
        <Search size={20} strokeWidth={1.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" aria-hidden="true" />
        <input
          type="search"
          name="search"
          placeholder="输入关键词…"
          aria-label="搜索音乐"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-bg-secondary border border-border-primary pl-12 pr-5 py-3 rounded-xl text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-subtle focus-visible:shadow-[0_0_12px_var(--accent-subtle)] transition-[border-color,box-shadow] duration-200"
        />
      </div>

      <div
        className="flex gap-2 mb-6 animate-fade-in-up [animation-delay:100ms]"
        role="tablist"
        aria-label="音乐源"
        onKeyDown={handleTablistKeyDown}
      >
        {tabs.map((t, index) => (
          <button
            key={t}
            ref={(node) => { tabRefs.current[index] = node; }}
            type="button"
            id={`search-source-tab-${t}`}
            role="tab"
            aria-selected={source === t}
            aria-controls={panelId}
            tabIndex={source === t ? 0 : -1}
            onClick={() => setSource(t)}
            className={`px-4 py-1.5 rounded-full text-sm transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              source === t
                ? 'bg-gradient-accent text-white font-medium shadow-sm'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {t === 'all' ? '全部' : t === 'netease' ? '网易云' : 'QQ音乐'}
          </button>
        ))}
      </div>

      <div
        id={panelId}
        className="flex-1 overflow-y-auto min-h-0"
        role="tabpanel"
        aria-labelledby={`search-source-tab-${source}`}
        aria-live="polite"
      >
        {loading && (
          <div className="space-y-3 py-4" role="status" aria-busy="true" aria-label="搜索中">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center px-4 py-2.5 gap-3 animate-pulse">
                <div className="w-10 h-4 bg-bg-secondary rounded" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-bg-secondary rounded w-2/3" />
                  <div className="h-3 bg-bg-secondary rounded w-1/3" />
                </div>
                <div className="w-16 h-3 bg-bg-secondary rounded" />
              </div>
            ))}
          </div>
        )}
        {!loading && debouncedQuery && results.length === 0 && (
          <div className="text-center py-16">
            <SearchX size={64} strokeWidth={1} className="text-text-tertiary mx-auto mb-4 opacity-50" aria-hidden="true" />
            <p className="text-text-tertiary">没有找到相关结果</p>
            <p className="text-text-tertiary text-sm mt-1">试试其他关键词或切换音乐源</p>
          </div>
        )}
        {!loading && !debouncedQuery && results.length === 0 && (
          <div className="text-center py-16">
            <Music size={64} strokeWidth={1} className="text-text-tertiary mx-auto mb-4 opacity-50" aria-hidden="true" />
            <p className="text-text-tertiary">搜索你喜欢的音乐</p>
          </div>
        )}
        {!loading && results.length > 0 && (
          <VirtualTrackList tracks={results} />
        )}
      </div>
    </div>
  );
}
