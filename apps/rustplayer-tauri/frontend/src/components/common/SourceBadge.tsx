interface SourceBadgeProps {
  source: 'netease' | 'qqmusic';
  className?: string;
}

export default function SourceBadge({ source, className = '' }: SourceBadgeProps) {
  const isNetease = source === 'netease';
  return (
    <span
      className={`inline-flex items-center text-[10px] leading-none px-1.5 py-0.5 rounded-full font-medium text-white ${
        isNetease ? 'bg-[#E60026]' : 'bg-[#31C27C]'
      } ${className}`}
    >
      {isNetease ? '网易' : 'QQ'}
    </span>
  );
}
