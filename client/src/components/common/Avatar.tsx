interface Props {
  src?: string;
  name: string;
  size?: number;
  online?: boolean;
  className?: string;
}

export function colorFor(id: string): string {
  const palette = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 99991;
  return palette[h % palette.length];
}

export default function Avatar({ src, name, size = 40, online, className = '' }: Props) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      {src ? (
        <img
          src={src}
          alt={name}
          className="w-full h-full rounded-full object-cover border border-slate-700"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : null}
      {!src && (
        <div
          className="w-full h-full rounded-full flex items-center justify-center font-bold text-white border border-white/10"
          style={{ background: colorFor(name), fontSize: size * 0.38 }}
        >
          {initials || '?'}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-slate-950 ${
            online ? 'bg-green-500' : 'bg-slate-600'
          }`}
          style={{ width: size * 0.28, height: size * 0.28 }}
        />
      )}
    </div>
  );
}
