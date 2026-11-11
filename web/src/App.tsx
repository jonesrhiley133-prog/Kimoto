import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { initNative, isNative, onNotificationTap, serverUrl } from '@/lib/native';
import { useAuth } from '@/hooks/app';
import { Layout } from '@/components/Layout';
import { PageLoader } from '@/components/ui';

const Auth = lazy(() => import('./pages/Auth'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Home = lazy(() => import('./pages/Home'));
const Discover = lazy(() => import('./pages/Discover'));
const Search = lazy(() => import('./pages/Search'));
const TitlePage = lazy(() => import('./pages/TitlePage'));
const Reader = lazy(() => import('./pages/Reader'));
const Library = lazy(() => import('./pages/Library'));
const Lists = lazy(() => import('./pages/Lists'));
const ListPage = lazy(() => import('./pages/ListPage'));
const Downloads = lazy(() => import('./pages/Downloads'));
const Stats = lazy(() => import('./pages/Stats'));
const Wrapped = lazy(() => import('./pages/Wrapped'));
const Community = lazy(() => import('./pages/Community'));
const ThreadPage = lazy(() => import('./pages/ThreadPage'));
const Messages = lazy(() => import('./pages/Messages'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Profile = lazy(() => import('./pages/Profile'));
const Settings = lazy(() => import('./pages/settings/Settings'));
const Moderation = lazy(() => import('./pages/Moderation'));
const Misc = lazy(() => import('./pages/Misc'));
const ServerSetup = lazy(() => import('./pages/ServerSetup'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!user.prefs?.onboarded && loc.pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  return <>{children}</>;
}
const P = (el: ReactNode) => <RequireAuth>{el}</RequireAuth>;

export function App() {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  useEffect(() => {
    initNative({
      navigateBack: () => nav(-1),
      // Coming back to the app (e.g. after authorizing MAL/AniList in the browser): refresh live data.
      onResume: () => { qc.invalidateQueries(); window.dispatchEvent(new Event('focus')); },
    });
    onNotificationTap((link) => nav(link));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Native app without a server configured yet: ask for one first.
  if (isNative && !serverUrl()) return <Suspense fallback={<PageLoader />}><ServerSetup /></Suspense>;
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
        <Route path="/forgot-password" element={<Auth mode="forgot" />} />
        <Route path="/reset-password" element={<Auth mode="reset" />} />
        <Route path="/verify-email" element={<Auth mode="verify" />} />
        <Route path="/welcome" element={P(<Onboarding />)} />
        <Route path="/read/:chapterId" element={<Reader />} />
        <Route element={<Layout />}>
          <Route index element={user ? P(<Home />) : <Discover />} />
          <Route path="discover" element={<Discover />} />
          <Route path="discover/search" element={<Search />} />
          <Route path="title/:id" element={<TitlePage />} />
          <Route path="library" element={P(<Library />)} />
          <Route path="lists" element={P(<Lists />)} />
          <Route path="lists/:id" element={<ListPage />} />
          <Route path="downloads" element={<Downloads />} />
          <Route path="stats" element={P(<Stats />)} />
          <Route path="stats/wrapped" element={P(<Wrapped />)} />
          <Route path="community" element={<Community />} />
          <Route path="community/:tab" element={<Community />} />
          <Route path="threads/:id" element={<ThreadPage />} />
          <Route path="messages" element={P(<Messages />)} />
          <Route path="messages/:id" element={P(<Messages />)} />
          <Route path="notifications" element={P(<Notifications />)} />
          <Route path="profile" element={user ? <Navigate to={`/u/${user.username}`} replace /> : <Navigate to="/login" replace />} />
          <Route path="u/:username" element={<Profile />} />
          <Route path="settings" element={P(<Settings />)} />
          <Route path="settings/:section" element={P(<Settings />)} />
          <Route path="moderation" element={P(<Moderation />)} />
          <Route path="guidelines" element={<Misc page="guidelines" />} />
          <Route path="*" element={<Misc page="404" />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
