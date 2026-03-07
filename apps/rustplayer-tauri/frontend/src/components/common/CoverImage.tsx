import { useState, useEffect } from 'react';
import { Music } from 'lucide-react';

interface CoverImageProps {
  src?: string;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  iconSize?: number;
  fallbackIcon?: React.ReactNode;
  /** 可选的固有宽度，用于已知尺寸时稳定布局。 */
  width?: number;
  /** 可选的固有高度，用于已知尺寸时稳定布局。 */
  height?: number;
  /** Reset error state when this key changes (e.g. track id). */
  resetKey?: string;
  /** When true, loads image eagerly (no lazy loading). Use for above-the-fold images. */
  eager?: boolean;
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
  eager = false,
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
      loading={eager ? 'eager' : 'lazy'}
      decoding={eager ? 'sync' : 'async'}
      onError={() => setFailed(true)}
    />
  );
}
