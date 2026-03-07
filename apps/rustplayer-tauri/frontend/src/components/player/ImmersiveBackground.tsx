import FullscreenVisualizer from '@/components/player/FullscreenVisualizer';
import ParticleSystem from '@/components/player/ParticleSystem';

interface Props {
  width: number;
  height: number;
}

export default function ImmersiveBackground({ width, height }: Props) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <div className="absolute inset-0 opacity-20">
        <FullscreenVisualizer width={width} height={height} />
      </div>
      <div className="absolute inset-0 opacity-30">
        <ParticleSystem width={width} height={height} />
      </div>
    </div>
  );
}
