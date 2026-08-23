import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app';
import { buildDevBridge } from './dev-bridge';

const container = document.getElementById('root');
if (!container) throw new Error('root element not found');

// In tests / E2E, allow injecting a mock bridge via a global. In production
// the bridge comes from the preload script.
declare global {
  interface Window {
    workbenchApi: import('../preload/index').WorkbenchApi;
    __WORKBENCH_API_OVERRIDE__?: import('../preload/index').WorkbenchApi;
  }
}

if (!window.workbenchApi) {
  if (window.__WORKBENCH_API_OVERRIDE__) {
    window.workbenchApi = window.__WORKBENCH_API_OVERRIDE__;
  } else {
    // Vite dev server has no preload script. Install a dev bridge that
    // talks to the backend via fetch / EventSource so the rest of the
    // UI is exercisable end-to-end from the browser.
    window.workbenchApi = buildDevBridge() as unknown as import('../preload/index').WorkbenchApi;
  }
}

// macOS builds run with a hiddenInset titlebar; flag the platform so the
// stylesheet can clear the traffic-light buttons in the sidebar.
if (/Mac OS X|Macintosh/.test(navigator.userAgent)) {
  document.body.classList.add('is-mac');
}

// The packaged app is loaded via file:// (win.loadFile). On Windows,
// Chromium refuses history.pushState/replaceState from a file: document,
// so BrowserRouter's initial <Navigate to="/"> never resolves and every
// routed page stays blank. Hash routing keeps all navigation inside the
// URL fragment and never touches the History API.
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <HashRouter
      future={{
        v7_relativeSplatPath: true,
        v7_startTransition: true
      }}
    >
      <App />
    </HashRouter>
  </React.StrictMode>
);
