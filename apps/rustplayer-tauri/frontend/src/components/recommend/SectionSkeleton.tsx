interface SectionSkeletonProps {
  type: 'cards' | 'artists' | 'list';
}

export default function SectionSkeleton({ type }: SectionSkeletonProps) {
  if (type === 'artists') {
    return (
      <div className="animate-pulse flex gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center w-[120px] flex-shrink-0 py-3">
            <div className="w-20 h-20 rounded-full bg-[var(--bg-secondary)]" />
            <div className="h-3 w-16 bg-[var(--bg-secondary)] rounded mt-2" />
            <div className="h-2 w-10 bg-[var(--bg-secondary)] rounded mt-1" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="animate-pulse flex gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="w-[160px] flex-shrink-0 rounded-lg overflow-hidden">
          <div className="aspect-square bg-[var(--bg-secondary)]" />
          <div className="p-2.5 space-y-1.5">
            <div className="h-3.5 bg-[var(--bg-secondary)] rounded w-4/5" />
            <div className="h-3 bg-[var(--bg-secondary)] rounded w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
