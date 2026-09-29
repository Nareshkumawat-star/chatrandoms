export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-slate-600 border-t-sky-400 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="skeleton w-9 h-9 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="skeleton h-3 w-1/3" />
        <div className="skeleton h-2 w-2/3" />
      </div>
    </div>
  );
}
