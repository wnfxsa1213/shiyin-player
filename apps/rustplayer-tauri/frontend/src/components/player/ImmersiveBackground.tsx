import FullscreenVisualizer from '@/components/player/FullscreenVisualizer';

interface Props {
  width: number;
  height: number;
}

export default function ImmersiveBackground({ width, height }: Props) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <FullscreenVisualizer width={width} height={height} alpha={0.25} />
    </div>
  );
}
