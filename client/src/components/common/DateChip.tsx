export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'TODAY';
  if (same(d, yest)) return 'YESTERDAY';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
}

export default function DateChip({ iso }: { iso: string }) {
  return (
    <div className="wa-date-chip">
      <span>{dayLabel(iso)}</span>
    </div>
  );
}
