import { ConstellationField } from '@designcodeio/threeui/components/ConstellationField';

type Tone = 'sky' | 'violet' | 'amber' | 'emerald';

const HUES: Record<Tone, number> = { sky: 200, violet: 265, amber: 40, emerald: 150 };

/**
 * Ambient ThreeUI particle background (ConstellationField).
 * Props forwarded to the library component (mode, speed, opacity, hue...).
 */
export default function PulseBackground({
  tone = 'sky',
  variant = 'constellation-field',
  className = '',
}: {
  tone?: Tone;
  variant?: 'constellation-field' | 'particle-drift' | 'particle-network' | 'gateway-flow' | 'connectivity-graph' | 'interface-lines' | 'defense-lines' | 'topo-field';
  className?: string;
}) {
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden>
      <ConstellationField
        variant={variant}
        mode="dark"
        hue={HUES[tone]}
        saturation={0.8}
        brightness={1.1}
        opacity={0.55}
        speed={0.6}
        density={0.7}
        className="w-full h-full"
      />
    </div>
  );
}
