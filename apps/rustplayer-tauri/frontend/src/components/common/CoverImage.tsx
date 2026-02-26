import { useState, useEffect } from 'react';
import { Music } from 'lucide-react';

interface CoverImageProps {
  src?: string;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  iconSize?: number;
  fallbackIcon?: React.ReactNode;
  width?: number;
  height?: number;
  /** Reset error state when this key changes (e.g. track id). */
  resetKey?: string;
}

export default function CoverImage({
  src,
  alt = '',
  className = '',
  fallbackClassName,
  iconSize = 20,
  fallbackIcon,
  width,
  height,
  resetKey,
}: CoverImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src, resetKey]);

  if (!src || failed) {
    return (
      <div className={fallbackClassName ?? className} style={{ width, height }}>
        {fallbackIcon ?? <Music size={iconSize} strokeWidth={1.5} className="text-text-tertiary" aria-hidden="true" />}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
