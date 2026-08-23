import React from 'react';
import { useLocation } from 'react-router-dom';
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserState
} from '../../../shared/contracts';
import type { GeneratedArtifact } from '../document-preview/DocumentPreviewContext';

const INITIAL_BROWSER_STATE: BrowserState = {
  available: false,
  mode: 'preview',
  visible: false,
  url: '',
  title: '浏览器',
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  lastError: null,
  artifactId: null,
  artifactDisplayName: null
};

interface BrowserWorkspaceValue {
  state: BrowserState;
  open: (url?: string) => Promise<void>;
  openArtifact: (artifact: GeneratedArtifact) => Promise<void>;
  close: () => Promise<void>;
  navigate: (url: string) => Promise<BrowserActionResult>;
  execute: (action: BrowserAction) => Promise<BrowserActionResult>;
}

const BrowserWorkspaceContext = React.createContext<BrowserWorkspaceValue | null>(
  null
);

export function supportsBrowserWorkspace(pathname: string): boolean {
  return pathname === '/' || pathname.startsWith('/assistant');
}

export function BrowserWorkspaceProvider({
  children
}: {
  children: React.ReactNode;
}): JSX.Element {
  const location = useLocation();
  const [state, setState] = React.useState<BrowserState>(INITIAL_BROWSER_STATE);

  React.useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void window.workbenchApi
      .browserGetState()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active) setState(INITIAL_BROWSER_STATE);
      });
    void window.workbenchApi
      .subscribeBrowserState((next) => {
        if (active) setState(next);
      })
      .then((teardown) => {
        if (active) unsubscribe = teardown;
        else teardown();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  React.useEffect(() => {
    if (supportsBrowserWorkspace(location.pathname) || !state.visible) return;
    void window.workbenchApi.browserSetVisible(false).then(setState);
  }, [location.pathname, state.visible]);

  const open = React.useCallback(async (url?: string) => {
    setState(await window.workbenchApi.browserSetVisible(true));
    if (url) {
      const result = await window.workbenchApi.browserNavigate(url);
      setState(result.state);
      if (!result.ok) throw new Error(result.message);
    }
  }, []);

  const close = React.useCallback(async () => {
    setState(await window.workbenchApi.browserSetVisible(false));
  }, []);

  const openArtifact = React.useCallback(async (artifact: GeneratedArtifact) => {
    const result = await window.workbenchApi.browserOpenArtifact({
      artifactId: artifact.artifactId,
      displayName: artifact.displayName
    });
    setState(result.state);
    if (!result.ok) throw new Error(result.message);
  }, []);

  const navigate = React.useCallback(async (url: string) => {
    const result = await window.workbenchApi.browserNavigate(url);
    setState(result.state);
    return result;
  }, []);

  const execute = React.useCallback(async (action: BrowserAction) => {
    const result = await window.workbenchApi.browserAction(action);
    setState(result.state);
    return result;
  }, []);

  const value = React.useMemo<BrowserWorkspaceValue>(
    () => ({ state, open, openArtifact, close, navigate, execute }),
    [close, execute, navigate, open, openArtifact, state]
  );

  return (
    <BrowserWorkspaceContext.Provider value={value}>
      {children}
    </BrowserWorkspaceContext.Provider>
  );
}

export function useBrowserWorkspace(): BrowserWorkspaceValue {
  const value = React.useContext(BrowserWorkspaceContext);
  if (!value) {
    throw new Error('useBrowserWorkspace must be used inside BrowserWorkspaceProvider');
  }
  return value;
}
