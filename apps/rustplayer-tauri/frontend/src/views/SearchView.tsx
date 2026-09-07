import { useRef } from 'react';
import VirtualTrackList from '@/components/common/VirtualTrackList';
import { useMusicSearch, searchSourceNames, type SearchSource } from '@/hooks/useMusicSearch';
import { Search, SearchX, Music, RefreshCw, X, CircleAlert } from 'lucide-react';

const tabs = ['all', 'netease', 'qqmusic'] as const;

function SearchContext({ query, source, count }: { query: string; source: SearchSource; count?: number }) {
  return <span className="search-context"><span className="search-query" title={query}>「{query}」</span>
    <span className="search-source"> · {searchSourceNames[source]}{count === undefined ? '' : ` · ${count} 首结果`}</span></span>;
}

export default function SearchView() {
  const { query, source, state, setQuery, setSource, submit, beginComposition, endComposition } = useMusicSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pending = state.phase === 'waiting' || state.phase === 'loading';
  const result = state.result;
  const oldResult = result !== null && state.phase !== 'success';

  const focusTab = (index: number) => {
    const nextIndex = (index + tabs.length) % tabs.length;
    setSource(tabs[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleTablistKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.indexOf(source);
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (next !== undefined) { event.preventDefault(); focusTab(next); }
  };

  return (
    <div className="search-page discovery-page">
      <header className="discovery-heading">
        <h1>搜索</h1>
        <p>找一首想听的歌，或探索喜欢的歌手。</p>
      </header>

      <form role="search" className="search-form" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className="search-input-wrap">
          <Search size={20} aria-hidden="true" />
          <input ref={inputRef} type="search" name="search" placeholder="歌曲、歌手或专辑"
            aria-label="搜索音乐" autoComplete="off" value={query}
            onChange={event => setQuery(event.target.value)} onCompositionStart={beginComposition}
            onCompositionEnd={event => endComposition(event.currentTarget.value)}
            onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
          {query && <button type="button" className="player-icon-button" aria-label="清空搜索"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}><X size={17} /></button>}
        </div>
        <button className="discovery-button is-primary" type="submit" disabled={!query.trim()}>搜索</button>
      </form>

      <div className="search-tabs" role="tablist" aria-label="音乐源" onKeyDown={handleTablistKeyDown}>
        {tabs.map((tab, index) => (
          <button key={tab} ref={node => { tabRefs.current[index] = node; }} type="button"
            id={`search-source-tab-${tab}`} role="tab" aria-selected={source === tab}
            aria-controls="search-source-panel" tabIndex={source === tab ? 0 : -1}
            onClick={() => { if (source !== tab) setSource(tab); }}>
            {searchSourceNames[tab]}
          </button>
        ))}
      </div>

      <div className="search-announcement" role="status" aria-live="polite" aria-atomic="true">
        {pending && <p><RefreshCw size={15} className={state.phase === 'loading' ? 'playback-spinner' : ''} aria-hidden="true" />
          <span className="search-phase">{state.phase === 'waiting' ? '准备搜索' : '正在搜索'}</span><SearchContext {...state.target} /></p>}
        {state.phase === 'error' && <div className="discovery-notice is-error">
          <CircleAlert size={18} aria-hidden="true" />
          <div><strong>搜索失败</strong><p><SearchContext {...state.target} /></p><p>{state.message}</p></div>
          <button type="button" className="discovery-button" onClick={submit}>重试搜索</button>
        </div>}
        {state.phase === 'success' && result && <p><SearchContext {...result} count={result.tracks.length} /></p>}
      </div>

      <div id="search-source-panel" className="search-results" role="tabpanel"
        aria-labelledby={`search-source-tab-${source}`}>
        {state.phase === 'idle' && <div className="discovery-empty search-empty">
          <Music size={42} strokeWidth={1.3} aria-hidden="true" /><h2>搜索你喜欢的音乐</h2><p>输入关键词开始搜索，也可以按 Enter 立即搜索。</p>
        </div>}
        {pending && !result && <div className="search-skeleton" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <div key={index}><span /><span /></div>)}
        </div>}
        {result && <>
          {oldResult && <p className="search-previous"><span className="search-phase">上次结果：</span><SearchContext {...result} count={result.tracks.length} /></p>}
          {result.tracks.length > 0
            ? <VirtualTrackList key={result.revision} tracks={result.tracks} />
            : <div className="discovery-empty search-empty"><SearchX size={42} strokeWidth={1.3} aria-hidden="true" />
              <h2>{oldResult ? '上次搜索没有找到相关结果' : '没有找到相关结果'}</h2><p>试试其他关键词或切换音乐源。</p></div>}
        </>}
      </div>
    </div>
  );
}
