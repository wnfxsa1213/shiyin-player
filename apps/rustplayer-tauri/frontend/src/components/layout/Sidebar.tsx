import { NavLink, useNavigate } from 'react-router-dom';
import { useUiStore } from '@/store/uiStore';
import { usePlaylistStore } from '@/store/playlistStore';
import { Home, Search, Settings, Music, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';

const navItems: { path: string; label: string; icon: LucideIcon }[] = [
  { path: '/', label: '首页', icon: Home },
  { path: '/search', label: '搜索', icon: Search },
  { path: '/settings', label: '设置', icon: Settings },
];

export default function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const playlists = usePlaylistStore((s) => s.playlists);
  const navigate = useNavigate();

  return (
    <nav
      className={`${collapsed ? 'w-16' : 'w-56'} bg-bg-primary/80 glass flex-shrink-0 flex flex-col border-r border-border-primary transition-all duration-300`}
      aria-label="主导航"
    >
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="w-9 h-9 rounded-lg bg-gradient-accent flex items-center justify-center flex-shrink-0 shadow-glow">
          <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        </div>
        {!collapsed && (
          <span className="text-lg font-semibold tracking-tight">拾音</span>
        )}
        <button
          onClick={() => useUiStore.getState().toggleSidebar()}
          className="ml-auto p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
        </button>
      </div>

      <ul className="flex-1 space-y-1 px-2 mt-2">
        {navItems.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-accent-subtle text-accent font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
                  )}
                  <item.icon size={20} strokeWidth={1.5} className="flex-shrink-0" />
                  {!collapsed && <span className="text-sm">{item.label}</span>}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {playlists.length > 0 && (
        <div className="px-2 mt-2 border-t border-border-secondary pt-2 flex-1 overflow-y-auto min-h-0">
          {!collapsed && <div className="px-3 py-1 text-xs text-text-tertiary font-medium">歌单</div>}
          <ul className="space-y-0.5">
            {playlists.map((pl) => (
              <li key={`${pl.source}-${pl.id}`}>
                <button
                  onClick={() => navigate(`/playlist/${pl.source}/${pl.id}`)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-200 cursor-pointer"
                >
                  {pl.coverUrl ? (
                    <img src={pl.coverUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-6 h-6 rounded bg-bg-secondary flex items-center justify-center flex-shrink-0">
                      <Music size={12} strokeWidth={1.5} />
                    </div>
                  )}
                  {!collapsed && <span className="text-sm truncate" title={pl.name}>{pl.name}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-4 py-3 border-t border-border-secondary text-xs text-text-tertiary">
        {!collapsed ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-soft" />
            <span>网易云 · QQ音乐</span>
          </div>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-soft block mx-auto" />
        )}
      </div>
    </nav>
  );
}
