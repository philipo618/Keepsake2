import React, { Component, useEffect, useState } from 'react';
import { AppProvider } from './components/AppContext';
import { Footer } from './components/Footer';
import { Navbar, type AppRoute } from './components/Navbar';
import { parseFragmentAndKey } from './lib/cryptoVault';
import { AdminDashboard } from './pages/AdminDashboard';
import { CreatorDashboard } from './pages/CreatorDashboard';
import { CreatorWizard } from './pages/CreatorWizard';
import { ExplorePage } from './pages/ExplorePage';
import { LandingPage } from './pages/LandingPage';
import { RecipientGreetingPage } from './pages/RecipientGreetingPage';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: err?.message || 'An unexpected application error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B0F17] p-6">
          <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#131924] p-6 text-center space-y-4 shadow-lg">
            <h1 className="font-display text-2xl font-semibold text-slate-900 dark:text-white">
              Something went wrong
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#/';
                window.location.reload();
              }}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-rose-700 text-white text-sm font-medium"
            >
              Return Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function getNormalizedBase(): string {
  const raw = import.meta.env.BASE_URL || '/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function parseRouteFromLocation(): AppRoute {
  const rawHash = window.location.hash || '';
  const { routeHash, encryptionKey } = parseFragmentAndKey(rawHash);

  if (routeHash && routeHash.startsWith('#')) {
    const hashBody = routeHash.slice(1); // e.g. /view/ks_123 or /create?template=abc
    const [rawPath, rawSearch] = hashBody.split('?');
    const clean = (rawPath || '/').replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(rawSearch || '');

    if (clean.startsWith('/view/')) {
      const id = decodeURIComponent(clean.slice('/view/'.length).split('/')[0] || '');
      if (id) return { page: 'greeting', id, keyFragment: encryptionKey };
    }
    if (clean.startsWith('/g/')) {
      const id = decodeURIComponent(clean.slice('/g/'.length).split('/')[0] || '');
      if (id) return { page: 'greeting', id, keyFragment: encryptionKey };
    }
    if (clean === '/explore') return { page: 'explore' };
    if (clean === '/create') {
      return {
        page: 'create',
        editId: params.get('edit') || undefined,
        templateId: params.get('template') || undefined,
        categoryId: params.get('category') || undefined,
        openVideoStudio: params.get('video') === '1',
      };
    }
    if (clean === '/studio') return { page: 'dashboard' };
    if (clean === '/admin') return { page: 'admin' };
    if (clean === '/' || clean === '') return { page: 'landing' };
  }

  // Fallback compatibility for direct pathname links (e.g. /Keepsake2/explore or /Keepsake2/g/abc)
  const base = getNormalizedBase();
  const baseNoSlash = base.length > 1 ? base.slice(0, -1) : '';
  let path = window.location.pathname;
  if (base !== '/' && path.startsWith(base)) {
    path = '/' + path.slice(base.length);
  } else if (baseNoSlash && path === baseNoSlash) {
    path = '/';
  }
  const cleanPath = path.replace(/\/+$/, '') || '/';
  const searchParams = new URLSearchParams(window.location.search);

  if (cleanPath.startsWith('/view/')) {
    const id = decodeURIComponent(cleanPath.slice('/view/'.length).split('/')[0] || '');
    if (id) return { page: 'greeting', id, keyFragment: encryptionKey };
  }
  if (cleanPath.startsWith('/g/')) {
    const id = decodeURIComponent(cleanPath.slice('/g/'.length).split('/')[0] || '');
    if (id) return { page: 'greeting', id, keyFragment: encryptionKey };
  }
  if (cleanPath === '/explore') return { page: 'explore' };
  if (cleanPath === '/create') {
    return {
      page: 'create',
      editId: searchParams.get('edit') || undefined,
      templateId: searchParams.get('template') || undefined,
      categoryId: searchParams.get('category') || undefined,
      openVideoStudio: searchParams.get('video') === '1',
    };
  }
  if (cleanPath === '/studio') return { page: 'dashboard' };
  if (cleanPath === '/admin') return { page: 'admin' };
  return { page: 'landing' };
}

function buildHashForRoute(route: AppRoute): string {
  switch (route.page) {
    case 'landing':
      return '#/';
    case 'explore':
      return '#/explore';
    case 'dashboard':
      return '#/studio';
    case 'admin':
      return '#/admin';
    case 'greeting': {
      const base = `#/view/${encodeURIComponent(route.id)}`;
      return route.keyFragment ? `${base}#key=${encodeURIComponent(route.keyFragment)}` : base;
    }
    case 'create': {
      const qs = new URLSearchParams();
      if (route.editId) qs.set('edit', route.editId);
      if (route.templateId) qs.set('template', route.templateId);
      if (route.categoryId) qs.set('category', route.categoryId);
      if (route.openVideoStudio) qs.set('video', '1');
      const qStr = qs.toString();
      return `#/create${qStr ? `?${qStr}` : ''}`;
    }
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRouteFromLocation());

  useEffect(() => {
    const syncRoute = () => {
      setRoute(parseRouteFromLocation());
    };
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  const navigate = (next: AppRoute) => {
    const nextHash = buildHashForRoute(next);
    window.location.hash = nextHash;
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isGreetingView = route.page === 'greeting';

  return (
    <AppErrorBoundary>
      <AppProvider>
        <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-[#0B0F17] dark:text-slate-100">
          {!isGreetingView ? (
            <Navbar route={route} navigate={navigate} />
          ) : (
            <header className="border-b border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-[#0B0F17]/80 backdrop-blur-md">
              <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => navigate({ page: 'landing' })}
                  className="font-display text-lg font-semibold text-slate-900 dark:text-white"
                >
                  Keepsake
                </button>
                <button
                  type="button"
                  onClick={() => navigate({ page: 'create' })}
                  className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-xs font-medium"
                >
                  Create Your Own
                </button>
              </div>
            </header>
          )}

          <div className="flex-1">
            {route.page === 'landing' && <LandingPage navigate={navigate} />}
            {route.page === 'explore' && <ExplorePage navigate={navigate} />}
            {route.page === 'create' && (
              <CreatorWizard
                key={`${route.editId || 'new'}-${route.templateId || ''}-${route.categoryId || ''}`}
                editId={route.editId}
                initialTemplateId={route.templateId}
                initialCategoryId={route.categoryId}
                initialOpenVideoStudio={route.openVideoStudio}
                navigate={navigate}
              />
            )}
            {route.page === 'dashboard' && <CreatorDashboard navigate={navigate} />}
            {route.page === 'admin' && <AdminDashboard navigate={navigate} />}
            {route.page === 'greeting' && (
              <RecipientGreetingPage
                greetingId={route.id}
                encryptionKeyFragment={route.keyFragment}
                navigate={navigate}
              />
            )}
          </div>

          {!isGreetingView && <Footer navigate={navigate} />}
        </div>
      </AppProvider>
    </AppErrorBoundary>
  );
}
