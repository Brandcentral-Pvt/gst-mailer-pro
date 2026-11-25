import React, { useCallback, useEffect, useState } from 'react';
import Shell from './components/Shell';
import Settings from './components/Settings';
import VendorDrawer from './components/VendorDrawer';
import { Toasts } from './components/ui';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import Matching from './pages/Matching';
import Mapping from './pages/Mapping';
import Campaign from './pages/Campaign';
import api from './lib/api';
import { LoginScreen, ChangePasswordDialog, logout } from './components/Auth';

let toastSeq = 0;

export default function App() {
  const [route, setRoute] = useState('dashboard');
  const [state, setState] = useState({
    loaded: false, stats: null, vendors: [], suggestions: [], settings: null, history: [],
  });
  const [toasts, setToasts] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('smtp');
  const [vendorOpen, setVendorOpen] = useState(null);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [flowDone, setFlowDone] = useState(() => new Set());

  const toast = useCallback((t) => {
    const id = ++toastSeq;
    setToasts((list) => [...list.slice(-3), { id, tone: 'info', ...t }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5600);
  }, []);
  const dismiss = (id) => setToasts((list) => list.filter((t) => t.id !== id));

  const goTo = useCallback((key) => {
    setRoute(key);
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }, []);
  const markFlowDone = useCallback((key) => {
    setFlowDone((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);
  const openSettings = useCallback((tab = 'smtp') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const res = await api.get('/api/state');
      setState((prev) => ({
        ...prev,
        ...res,
        settings: res.settings || prev.settings,
        vendors: res.vendors || prev.vendors || [],
      }));
    } catch (e) {
      toast({ tone: 'err', title: 'Server unreachable', body: e.message });
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    const onUnauthorized = () => { setUser(null); setPasswordOpen(false); };
    window.addEventListener('gst:unauthorized', onUnauthorized);
    api.get('/api/auth/me')
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setAuthChecked(true);
        refreshState();
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setAuthChecked(true);
      });
    return () => {
      cancelled = true;
      window.removeEventListener('gst:unauthorized', onUnauthorized);
    };
  }, [refreshState]);

  // Returning from the Google consent screen: /?gmail=connected | /?gmail=error&reason=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get('gmail');
    if (!gmail) return;
    window.history.replaceState({}, '', window.location.pathname);
    setSettingsTab('gmail');
    setSettingsOpen(true);
    refreshState();
    if (gmail === 'connected') {
      toast({ tone: 'ok', title: 'Gmail connected', body: 'OAuth access granted. Sending now uses the Gmail API.' });
    } else {
      toast({ tone: 'err', title: 'Gmail connection failed', body: params.get('reason') || 'Google did not return an authorisation code.' });
    }
  }, [refreshState, toast]);

  const onLoaded = (res) => {
    setState((prev) => ({
      ...prev,
      loaded: true,
      stats: res.stats,
      vendors: res.vendors,
      suggestions: res.suggestions || [],
    }));
    markFlowDone('upload');
  };

  const onVendors = (res) => {
    const nextVendors = res.vendors || state.vendors || [];
    setState((prev) => ({
      ...prev,
      vendors: res.vendors || prev.vendors,
      suggestions: res.suggestions ?? prev.suggestions,
    }));
    if (nextVendors.length && nextVendors.every((v) => v.recipients?.length && v.emailValid)) {
      markFlowDone('mapping');
    }
  };

  const onSettingsSaved = (saved) => setState((prev) => ({ ...prev, settings: saved }));
  const onLoggedIn = (me) => { setUser(me); setAuthChecked(true); refreshState(); };

  if (!authChecked) {
    return <div className="flex min-h-screen items-center justify-center bg-ink-950 text-[13px] font-semibold text-brand-200">Checking session…</div>;
  }
  if (!user) return <LoginScreen onLoggedIn={onLoggedIn} />;

  return (
    <>
      <Shell
        route={route}
        setRoute={goTo}
        state={state}
        onSettings={() => openSettings('smtp')}
        user={user}
        onChangePassword={() => setPasswordOpen(true)}
        onLogout={async () => { await logout(); }}
        flowDone={flowDone}
      >
        {route === 'dashboard' && (
          <Dashboard state={state} setRoute={goTo} openVendor={setVendorOpen}
            openSettings={openSettings} done={flowDone} />
        )}
        {route === 'upload' && (
          <Upload state={state} onLoaded={onLoaded} toast={toast} setRoute={goTo} />
        )}
        {route === 'matching' && (
          <Matching state={state} onVendors={onVendors} toast={toast} openVendor={setVendorOpen}
            setRoute={goTo} onDone={markFlowDone} />
        )}
        {route === 'mapping' && (
          <Mapping state={state} onVendors={onVendors} toast={toast} openVendor={setVendorOpen} setRoute={goTo} />
        )}
        {route === 'campaign' && (
          <Campaign state={state} openVendor={setVendorOpen} openSettings={openSettings}
            toast={toast} refreshState={refreshState} setRoute={goTo} />
        )}
      </Shell>

      <Settings
        initialTab={settingsTab}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={state.settings}
        onSaved={onSettingsSaved}
        toast={toast}
      />
      <VendorDrawer vendor={vendorOpen} onClose={() => setVendorOpen(null)} toast={toast} />
      <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <Toasts items={toasts} dismiss={dismiss} />
    </>
  );
}
