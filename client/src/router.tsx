import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router';
import { useAuth } from './store/auth';
import { Spinner } from './components/uiverse/Spinner';

const Landing = lazy(() => import('./pages/AuthPage'));
const PublicShell = lazy(() => import('./pages/PublicShell'));
const AppLayout = lazy(() => import('./pages/AppLayout'));
const GlobalChat = lazy(() => import('./pages/GlobalChat'));
const Chats = lazy(() => import('./pages/Chats'));
const Settings = lazy(() => import('./pages/Settings'));

function FullScreenLoader() {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[var(--wa-bg)]">
      <Spinner size={30} />
    </div>
  );
}

function RequireAuth() {
  const me = useAuth((s) => s.me);
  if (!me) return <Navigate to="/auth" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  {
    // Public landing — rendered inside the shell so the sidebar's
    // signed-out state (log in / create account) is reachable.
    path: '/',
    element: (
      <Suspense fallback={<FullScreenLoader />}>
        <PublicShell />
      </Suspense>
    ),
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<FullScreenLoader />}>
            <Landing />
          </Suspense>
        ),
      },
    ],
  },
  {
    path: '/auth',
    element: (
      <Suspense fallback={<FullScreenLoader />}>
        <PublicShell />
      </Suspense>
    ),
    children: [
      {
        index: true,
        element: (
          <Suspense fallback={<FullScreenLoader />}>
            <Landing />
          </Suspense>
        ),
      },
    ],
  },
  {
    path: '/app',
    element: (
      <Suspense fallback={<FullScreenLoader />}>
        <RequireAuth />
      </Suspense>
    ),
    children: [
      { index: true, element: <Navigate to="/app/global" replace /> },
      {
        path: 'global',
        element: (
          <Suspense fallback={<FullScreenLoader />}>
            <GlobalChat />
          </Suspense>
        ),
      },
      {
        path: 'chats',
        element: (
          <Suspense fallback={<FullScreenLoader />}>
            <Chats />
          </Suspense>
        ),
      },
      {
        path: 'settings',
        element: (
          <Suspense fallback={<FullScreenLoader />}>
            <Settings />
          </Suspense>
        ),
      },
    ],
  },
]);
