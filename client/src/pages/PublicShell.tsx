import { Outlet } from 'react-router';

/**
 * Shell for signed-out visitors — no sidebar here. The rail only appears once
 * the user is signed in (guest or registered), rendered by AppLayout.
 */
export default function PublicShell() {
  return (
    <div className="h-screen w-screen flex bg-[var(--wa-bg)] text-[var(--wa-text)] overflow-hidden app-shell-bg">
      <main className="flex-1 min-w-0 flex flex-col relative">
        <Outlet />
      </main>
    </div>
  );
}
