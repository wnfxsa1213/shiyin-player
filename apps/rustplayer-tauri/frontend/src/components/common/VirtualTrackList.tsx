import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Track } from '@/store/playerStore';
import TrackRow from './TrackRow';

interface Props {
  tracks: Track[];
}

export default function VirtualTrackList({ tracks }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto min-h-0">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vItem) => (
          <div
            key={vItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${vItem.start}px)`,
            }}
          >
            <TrackRow track={tracks[vItem.index]} index={vItem.index + 1} />
          </div>
        ))}
      </div>
    </div>
  );
}
