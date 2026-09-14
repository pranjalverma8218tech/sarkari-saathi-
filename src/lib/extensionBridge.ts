/**
 * Extension Bridge for SmartForm AI
 * Provides reliable, typed communication between the React Web Application
 * and the SmartForm AI Chrome Extension.
 * 
 * Implements the full explicit handshake protocol:
 * - EXTENSION_READY
 * - EXTENSION_PING
 * - EXTENSION_PONG
 * - TAB_READY
 */

import { useState, useEffect } from 'react';
import { FieldMapping } from '../types';

export interface OpenGovernmentFormResult {
  success: boolean;
  tabId?: number;
  windowId?: number;
  url?: string;
  reused?: boolean;
  status?: string;
  error?: string;
  message?: string;
}

export interface AutofillFormResult {
  success: boolean;
  tabId?: number;
  filledCount: number;
  filledFields: string[];
  manualFields: string[];
  error?: string;
  message?: string;
}

export interface FocusFormTabResult {
  success: boolean;
  tabExists?: boolean;
  tabExistence?: boolean;
  tabId?: number;
  windowId?: number;
  storedTargetTabId?: number;
  storedTargetWindowId?: number;
  currentTabUrl?: string | null;
  urlValidationResult?: string;
  focusOperationResult?: string;
  sessionId?: string;
  url?: string;
  title?: string;
  isExactUrl?: boolean;
  urlMatches?: boolean;
  error?: string;
  message?: string;
  lastKnownUrl?: string;
  inspectedUrl?: string;
  pageTitle?: string;
}

export interface ReopenFormResult {
  success: boolean;
  tabId?: number;
  windowId?: number;
  url?: string;
  error?: string;
  message?: string;
}

export interface FormStatusResult {
  success: boolean;
  tabExists: boolean;
  tabId?: number;
  url?: string;
  title?: string;
  error?: string;
}

export interface InspectFormTabResult {
  success: boolean;
  tabId?: number;
  url?: string;
  title?: string;
  fields?: any[];
  error?: string;
}

export interface ExtensionConnectionState {
  extensionStatus: 'CONNECTED' | 'WAITING';
  isExtensionConnected: boolean;
  extensionId: string | null;
  version: string | null;
  targetTabStatus: 'CONNECTED' | 'WAITING';
  isTargetTabConnected: boolean;
  targetTabId: number | null;
  targetTabWindowId: number | null;
  targetTabUrl: string | null;
  lastPingAt: number;
}

function generateRequestId(): string {
  return 'req_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();
}

// Global observable connection state
let globalConnectionState: ExtensionConnectionState = {
  extensionStatus: 'WAITING',
  isExtensionConnected: false,
  extensionId: null,
  version: null,
  targetTabStatus: 'WAITING',
  isTargetTabConnected: false,
  targetTabId: null,
  targetTabWindowId: null,
  targetTabUrl: null,
  lastPingAt: 0,
};

const listeners = new Set<(state: ExtensionConnectionState) => void>();

function updateGlobalState(partial: Partial<ExtensionConnectionState>) {
  globalConnectionState = {
    ...globalConnectionState,
    ...partial,
    isExtensionConnected: (partial.extensionStatus ?? globalConnectionState.extensionStatus) === 'CONNECTED',
    isTargetTabConnected: (partial.targetTabStatus ?? globalConnectionState.targetTabStatus) === 'CONNECTED',
  };
  listeners.forEach((cb) => {
    try {
      cb(globalConnectionState);
    } catch (e) {}
  });
}

/**
 * Initializes listeners for extension events and broadcasts.
 */
function initBridgeListeners() {
  if (typeof window === 'undefined') return;

  // Check initial DOM flags if content-script already executed
  if (typeof document !== 'undefined' && document.documentElement) {
    const isActive = document.documentElement.getAttribute('data-smartform-extension-active') === 'true';
    const extId = document.documentElement.getAttribute('data-smartform-extension-id');
    const ver = document.documentElement.getAttribute('data-smartform-extension-version');
    if (isActive) {
      (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
      updateGlobalState({
        extensionStatus: 'CONNECTED',
        extensionId: extId || globalConnectionState.extensionId,
        version: ver || '1.0.4',
      });
    }
  }

  // Window Message Listener
  window.addEventListener('message', (event) => {
    if (!event.data) return;

    // 1. EXTENSION_READY or SMARTFORM_EXTENSION_READY
    if (event.data.type === 'EXTENSION_READY' || event.data.type === 'SMARTFORM_EXTENSION_READY') {
      (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
      updateGlobalState({
        extensionStatus: 'CONNECTED',
        extensionId: event.data.extensionId || globalConnectionState.extensionId,
        version: event.data.version || '1.0.4',
      });
    }

    // 2. EXTENSION_PONG or SMARTFORM_PONG
    if (event.data.type === 'EXTENSION_PONG' || event.data.type === 'SMARTFORM_PONG') {
      (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
      const updates: Partial<ExtensionConnectionState> = {
        extensionStatus: 'CONNECTED',
        extensionId: event.data.extensionId || globalConnectionState.extensionId,
        version: event.data.version || '1.0.4',
        lastPingAt: Date.now(),
      };

      if (event.data.activeFormTabId) {
        updates.targetTabStatus = 'CONNECTED';
        updates.targetTabId = event.data.activeFormTabId;
      }
      if (event.data.activeTabContext?.tabId) {
        updates.targetTabStatus = 'CONNECTED';
        updates.targetTabId = event.data.activeTabContext.tabId;
        updates.targetTabUrl = event.data.activeTabContext.url || null;
      }

      updateGlobalState(updates);
    }

    // 3. TAB_READY
    if (event.data.type === 'TAB_READY') {
      updateGlobalState({
        targetTabStatus: 'CONNECTED',
        targetTabId: event.data.tabId || globalConnectionState.targetTabId,
        targetTabWindowId: event.data.windowId || globalConnectionState.targetTabWindowId,
        targetTabUrl: event.data.url || globalConnectionState.targetTabUrl,
      });
    }
  });

  // Custom DOM Event Listeners
  const onExtReady = (e: Event) => {
    const detail = (e as CustomEvent)?.detail;
    (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
    updateGlobalState({
      extensionStatus: 'CONNECTED',
      extensionId: detail?.extensionId || globalConnectionState.extensionId,
      version: detail?.version || '1.0.4',
    });
  };

  window.addEventListener('EXTENSION_READY', onExtReady);
  document.addEventListener('EXTENSION_READY', onExtReady);
  document.addEventListener('SmartFormExtensionReady', onExtReady);

  // Proactive initial ping
  pingExtension(1500).catch(() => {});
}

// Auto-run initialization once in browser context
if (typeof window !== 'undefined') {
  initBridgeListeners();
}

/**
 * Returns current extension connection state snapshot.
 */
export function getExtensionState(): ExtensionConnectionState {
  return globalConnectionState;
}

/**
 * Subscribes to changes in extension connection state.
 */
export function subscribeExtensionState(cb: (state: ExtensionConnectionState) => void): () => void {
  listeners.add(cb);
  cb(globalConnectionState);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * React hook to observe extension connection and target tab state reactively.
 */
export function useExtensionConnection() {
  const [state, setState] = useState<ExtensionConnectionState>(globalConnectionState);

  useEffect(() => {
    const unsub = subscribeExtensionState((s) => {
      setState(s);
    });
    // Ping on mount
    pingExtension(1500).catch(() => {});
    return unsub;
  }, []);

  return {
    ...state,
    checkConnection: (timeoutMs = 1500) => pingExtension(timeoutMs),
  };
}

/**
 * Sends an explicit EXTENSION_PING handshake to the companion extension.
 * Resolves with true if the extension responds with EXTENSION_PONG.
 */
export async function pingExtension(timeoutMs = 1500): Promise<{ installed: boolean; extensionId?: string; version?: string }> {
  if (typeof window === 'undefined') {
    return { installed: false };
  }

  // Fast check: document attribute
  if (typeof document !== 'undefined' && document.documentElement?.getAttribute('data-smartform-extension-active') === 'true') {
    const extId = document.documentElement.getAttribute('data-smartform-extension-id') || undefined;
    const ver = document.documentElement.getAttribute('data-smartform-extension-version') || '1.0.4';
    (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
    updateGlobalState({
      extensionStatus: 'CONNECTED',
      extensionId: extId || globalConnectionState.extensionId,
      version: ver,
    });
    return { installed: true, extensionId: extId, version: ver };
  }

  return new Promise((resolve) => {
    const id = generateRequestId();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', listener);
        // Do NOT permanently overwrite connected state if already connected
        if (!globalConnectionState.isExtensionConnected) {
          updateGlobalState({ extensionStatus: 'WAITING' });
        }
        resolve({ installed: globalConnectionState.isExtensionConnected });
      }
    }, timeoutMs);

    const listener = (event: MessageEvent) => {
      if (
        event.data &&
        (event.data.type === 'EXTENSION_PONG' ||
         event.data.type === 'SMARTFORM_PONG' ||
         event.data.type === 'EXTENSION_READY' ||
         event.data.type === 'SMARTFORM_EXTENSION_READY')
      ) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;

          const extId = event.data.extensionId || globalConnectionState.extensionId;
          const ver = event.data.version || '1.0.4';

          updateGlobalState({
            extensionStatus: 'CONNECTED',
            extensionId: extId,
            version: ver,
          });

          resolve({ installed: true, extensionId: extId, version: ver });
        }
      }
    };

    window.addEventListener('message', listener);

    // Broadcast EXTENSION_PING and SMARTFORM_PING
    window.postMessage({ type: 'EXTENSION_PING', id }, '*');
    window.postMessage({ type: 'SMARTFORM_PING', id }, '*');

    // Also attempt externally_connectable direct chrome.runtime messaging if available
    const knownExtId = globalConnectionState.extensionId || (typeof document !== 'undefined' ? document.documentElement?.getAttribute('data-smartform-extension-id') : null);
    const chromeRuntime = (window as any).chrome?.runtime;
    if (knownExtId && chromeRuntime && typeof chromeRuntime.sendMessage === 'function') {
      try {
        chromeRuntime.sendMessage(knownExtId, { type: 'EXTENSION_PING', action: 'PING' }, (response: any) => {
          if (response && !settled) {
            settled = true;
            clearTimeout(timer);
            window.removeEventListener('message', listener);
            (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
            updateGlobalState({
              extensionStatus: 'CONNECTED',
              extensionId: knownExtId,
              version: response.version || '1.0.4',
            });
            resolve({ installed: true, extensionId: knownExtId, version: response.version || '1.0.4' });
          }
        });
      } catch (e) {}
    }
  });
}

/**
 * Checks whether the companion extension is active.
 */
export async function isExtensionInstalled(forceCheck = false, timeoutMs = 1200): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (globalConnectionState.isExtensionConnected) return true;

  if (typeof document !== 'undefined' && document.documentElement?.getAttribute('data-smartform-extension-active') === 'true') {
    (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
    updateGlobalState({ extensionStatus: 'CONNECTED' });
    return true;
  }

  const pingRes = await pingExtension(timeoutMs);
  return pingRes.installed;
}

/**
 * Invokes an action on the Chrome Extension via the content script / background bridge.
 */
async function invokeExtensionAction<T>(action: string, payload: Record<string, any>, timeoutMs = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = generateRequestId();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', listener);
        reject(new Error(`EXTENSION_TIMEOUT: No response from SmartForm AI extension for action '${action}' within ${timeoutMs}ms.`));
      }
    }, timeoutMs);

    const listener = (event: MessageEvent) => {
      if (
        event.data &&
        event.data.type === 'SMARTFORM_INVOKE_RESPONSE' &&
        event.data.id === id
      ) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
          updateGlobalState({ extensionStatus: 'CONNECTED' });
          resolve(event.data as T);
        }
      }
    };

    window.addEventListener('message', listener);
    window.postMessage(
      {
        type: 'SMARTFORM_INVOKE',
        id,
        action,
        payload,
      },
      '*'
    );
  });
}

/**
 * Opens the government portal in Chrome, detects the tab, waits for content script TAB_READY,
 * and sets up direct tab communication.
 */
export async function openGovernmentForm(
  url: string,
  sessionId?: string,
  timeoutMs = 6000
): Promise<OpenGovernmentFormResult> {
  try {
    const isInstalled = await isExtensionInstalled(false, 1000);

    if (!isInstalled) {
      // Direct browser fallback if extension is not installed
      window.open(url, '_blank', 'noopener,noreferrer');
      return {
        success: true,
        url,
        status: 'opened_fallback',
        message: 'Opened form in browser tab. Reload extension in chrome://extensions to enable automated sync.',
      };
    }

    const res = await invokeExtensionAction<OpenGovernmentFormResult>(
      'OPEN_GOVERNMENT_FORM',
      { url, sessionId },
      timeoutMs
    );

    if (res.success && res.tabId) {
      updateGlobalState({
        targetTabStatus: 'CONNECTED',
        targetTabId: res.tabId,
        targetTabWindowId: res.windowId,
        targetTabUrl: res.url || url,
      });
    }

    return res;
  } catch (err: any) {
    // Fallback if extension bridge timed out
    window.open(url, '_blank', 'noopener,noreferrer');
    return {
      success: true,
      url,
      status: 'opened_fallback',
      message: 'Form opened in new tab. Companion extension is synchronizing.',
    };
  }
}

/**
 * Focuses the target government form tab in Chrome without reloading or navigating.
 */
export async function focusFormTab(
  params: {
    targetTabId?: number;
    targetWindowId?: number;
    sessionId?: string;
    expectedUrl?: string;
  },
  timeoutMs = 4000
): Promise<FocusFormTabResult> {
  try {
    const res = await invokeExtensionAction<FocusFormTabResult>(
      'FOCUS_FORM_TAB',
      {
        tabId: params.targetTabId || globalConnectionState.targetTabId,
        windowId: params.targetWindowId || globalConnectionState.targetTabWindowId,
        sessionId: params.sessionId,
        expectedUrl: params.expectedUrl,
      },
      timeoutMs
    );
    return res;
  } catch (err: any) {
    return {
      success: false,
      tabExists: false,
      error: 'FOCUS_FAILED',
      message: err.message || 'Could not focus target government form tab.',
    };
  }
}

/**
 * Reopens the exact last-known government form URL when the original tab was closed.
 */
export async function reopenGovernmentForm(
  params: { url: string; sessionId?: string },
  timeoutMs = 5000
): Promise<ReopenFormResult> {
  try {
    const res = await invokeExtensionAction<ReopenFormResult>(
      'REOPEN_GOVERNMENT_FORM',
      {
        url: params.url,
        sessionId: params.sessionId,
      },
      timeoutMs
    );
    if (res.success && res.tabId) {
      updateGlobalState({
        targetTabStatus: 'CONNECTED',
        targetTabId: res.tabId,
        targetTabWindowId: res.windowId,
        targetTabUrl: res.url || params.url,
      });
    }
    return res;
  } catch (err: any) {
    return {
      success: false,
      error: 'REOPEN_FAILED',
      message: err.message || 'Could not reopen government form tab.',
    };
  }
}

/**
 * Verifies tab existence and delivers Auto-Fill data directly into the live DOM.
 * Returns verified filled fields and manual fields count.
 */
export async function autofillForm(
  params: {
    sessionId: string;
    targetTabId?: number;
    targetWindowId?: number;
    mappings: FieldMapping[];
  },
  timeoutMs = 6000
): Promise<AutofillFormResult> {
  const effectiveTabId = params.targetTabId || globalConnectionState.targetTabId;
  const effectiveWindowId = params.targetWindowId || globalConnectionState.targetTabWindowId;

  try {
    const res = await invokeExtensionAction<AutofillFormResult>(
      'AUTOFILL_FORM',
      {
        sessionId: params.sessionId,
        targetTabId: effectiveTabId,
        targetWindowId: effectiveWindowId,
        mappings: params.mappings,
      },
      timeoutMs
    );
    return res;
  } catch (err: any) {
    const isNotActive = err.message?.includes('EXTENSION_NOT_ACTIVE') || err.message?.includes('EXTENSION_TIMEOUT');
    return {
      success: false,
      filledCount: 0,
      filledFields: [],
      manualFields: (params.mappings || []).map((m) => m.targetField),
      error: isNotActive ? 'EXTENSION_NOT_ACTIVE' : 'AUTOFILL_COMMUNICATION_FAILED',
      message: isNotActive
        ? 'Companion Chrome extension is not active in this browser. You can click "Go to Live Government Form" to open the form directly.'
        : (err.message || 'Failed to communicate auto-fill command to Chrome extension.'),
    };
  }
}

/**
 * Queries the status of the target government tab in Chrome.
 */
export async function getFormStatus(
  params: { targetTabId?: number; sessionId?: string },
  timeoutMs = 3000
): Promise<FormStatusResult> {
  try {
    const res = await invokeExtensionAction<FormStatusResult>(
      'GET_FORM_STATUS',
      {
        tabId: params.targetTabId || globalConnectionState.targetTabId,
        sessionId: params.sessionId,
      },
      timeoutMs
    );
    return res;
  } catch (err: any) {
    return {
      success: false,
      tabExists: false,
      error: err.message,
    };
  }
}

/**
 * Inspects form fields from a specific Chrome tab via the extension.
 */
export async function inspectFormTab(
  params: { tabId: number; url?: string },
  timeoutMs = 6000
): Promise<InspectFormTabResult> {
  try {
    const res = await invokeExtensionAction<InspectFormTabResult>(
      'INSPECT_FORM_TAB',
      {
        tabId: params.tabId,
        url: params.url,
      },
      timeoutMs
    );
    return res;
  } catch (err: any) {
    return {
      success: false,
      fields: [],
      error: err.message,
    };
  }
}
