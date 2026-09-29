export function Ticks({ read }: { read: boolean }) {
  return (
    <svg viewBox="0 0 16 11" width="16" height="11" className={read ? 'wa-tick' : ''} aria-label={read ? 'Read' : 'Delivered'}>
      <path
        d="M11.07.653a.5.5 0 0 1 .047.707L5.2 8.16a.5.5 0 0 1-.72.02L2.1 5.9a.5.5 0 1 1 .68-.73l2 1.86 5.6-6.33a.5.5 0 0 1 .71-.05Zm4 0a.5.5 0 0 1 .047.707L9.2 8.16a.5.5 0 0 1-.72.02l-.63-.59.68-.76.27.25 5.6-6.33a.5.5 0 0 1 .71-.05Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
