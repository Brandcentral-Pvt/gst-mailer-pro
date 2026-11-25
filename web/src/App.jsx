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

  const toast = useCallback((t) => {
    const id = ++toastSeq;
    setToasts((list) => [...list.slice(-3), { id, tone: 'info', ...t }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5600);
  }, []);
  const dismiss = (id) => setToasts((list) => list.filter((t) => t.id !== id));

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

  useEffect(() => { refreshState(); }, [refreshState]);

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
  };

  const onVendors = (res) => {
    setState((prev) => ({
      ...prev,
      vendors: res.vendors || prev.vendors,
      suggestions: res.suggestions ?? prev.suggestions,
    }));
  };

  const onSettingsSaved = (saved) => setState((prev) => ({ ...prev, settings: saved }));

  return (
    <>
      <Shell
        route={route}
        setRoute={setRoute}
        state={state}
        onSettings={() => { setSettingsTab('smtp'); setSettingsOpen(true); }}
      >
        {route === 'dashboard' && <Dashboard state={state} setRoute={setRoute} openVendor={setVendorOpen} />}
        {route === 'upload' && (
          <Upload state={state} onLoaded={onLoaded} toast={toast} setRoute={setRoute} />
        )}
        {route === 'matching' && (
          <Matching state={state} onVendors={onVendors} toast={toast} openVendor={setVendorOpen} />
        )}
        {route === 'mapping' && (
          <Mapping state={state} onVendors={onVendors} toast={toast} openVendor={setVendorOpen} />
        )}
        {route === 'campaign' && (
          <Campaign state={state} openVendor={setVendorOpen} openSettings={() => setSettingsOpen(true)} toast={toast} refreshState={refreshState} />
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
      <Toasts items={toasts} dismiss={dismiss} />
    </>
  );
}
