import { useState, useEffect } from 'react';
import { ipc } from '@/lib/ipc';
import { Track } from '@/store/playerStore';
import { useToastStore } from '@/store/toastStore';
import VirtualTrackList from '@/components/common/VirtualTrackList';
import { Search, SearchX, Music } from 'lucide-react';

export default function SearchView() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [source, setSource] = useState<'all' | 'netease' | 'qqmusic'>('all');
  const [results, setResults] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debounced.trim()) { setResults([]); return; }
    let active = true;
    setLoading(true);
    ipc.searchMusic(debounced, source === 'all' ? undefined : source)
      .then((r) => { if (active) setResults(r); })
      .catch((err) => {
        if (active) useToastStore.getState().addToast('error', `搜索失败: ${err}`);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [debounced, source]);

  const tabs = ['all', 'netease', 'qqmusic'] as const;

  return (
    <div className="p-8 pb-28 flex flex-col h-full">
      <h1 className="text-3xl font-bold mb-6 animate-fade-in-up">搜索</h1>

      <div className="relative w-full max-w-xl mb-6 animate-fade-in-up [animation-delay:50ms]">
        <Search size={20} strokeWidth={1.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          placeholder="输入关键词..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-bg-secondary border border-border-primary pl-12 pr-5 py-3 rounded-xl text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-subtle focus:shadow-[0_0_12px_var(--accent-subtle)] transition-all duration-200"
        />
      </div>

      <div className="flex gap-2 mb-6 animate-fade-in-up [animation-delay:100ms]" role="tablist" aria-label="音乐源">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={source === t}
            onClick={() => setSource(t)}
            className={`px-4 py-1.5 rounded-full text-sm transition-all duration-200 cursor-pointer ${
              source === t
                ? 'bg-gradient-accent text-white font-medium shadow-sm'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
          >
            {t === 'all' ? '全部' : t === 'netease' ? '网易云' : 'QQ音乐'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0" role="tabpanel">
        {loading && (
          <div className="space-y-3 py-4">
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
        {!loading && debounced && results.length === 0 && (
          <div className="text-center py-16">
            <SearchX size={64} strokeWidth={1} className="text-text-tertiary mx-auto mb-4 opacity-50" />
            <p className="text-text-tertiary">没有找到相关结果</p>
            <p className="text-text-tertiary text-sm mt-1">试试其他关键词或切换音乐源</p>
          </div>
        )}
        {!loading && !debounced && results.length === 0 && (
          <div className="text-center py-16">
            <Music size={64} strokeWidth={1} className="text-text-tertiary mx-auto mb-4 opacity-50" />
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
