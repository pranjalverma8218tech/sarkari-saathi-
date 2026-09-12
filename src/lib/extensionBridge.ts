/**
 * Extension Bridge for SmartForm AI
 * Provides reliable, typed communication between the React Web Application
 * and the SmartForm AI Chrome Extension.
 * 
 * Includes request-response correlation via unique IDs, timeouts, and verification.
 */

import { FieldMapping } from '../types';

export interface OpenGovernmentFormResult {
  success: boolean;
  tabId?: number;
  windowId?: number;
  url?: string;
  reused?: boolean;
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

function generateRequestId(): string {
  return 'req_' + Math.random().toString(36).slice(2, 11) + '_' + Date.now();
}

/**
 * Checks if the SmartForm AI Chrome Extension is installed and active in the browser.
 */
export async function pingExtension(timeoutMs = 1200): Promise<{ installed: boolean; version?: string }> {
  if (typeof window === 'undefined') {
    return { installed: false };
  }

  // Fast check: window flag
  if ((window as any).__SMARTFORM_EXTENSION_INSTALLED__) {
    return { installed: true, version: '1.0.3' };
  }

  return new Promise((resolve) => {
    const id = generateRequestId();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener('message', listener);
        resolve({ installed: false });
      }
    }, timeoutMs);

    const listener = (event: MessageEvent) => {
      if (event.data && (event.data.type === 'SMARTFORM_PONG' || event.data.type === 'SMARTFORM_EXTENSION_READY')) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          window.removeEventListener('message', listener);
          (window as any).__SMARTFORM_EXTENSION_INSTALLED__ = true;
          resolve({ installed: true, version: event.data.version || '1.0.3' });
        }
      }
    };

    window.addEventListener('message', listener);
    window.postMessage({ type: 'SMARTFORM_PING', id }, '*');
  });
}

/**
 * Invokes an action on the Chrome Extension via the content script bridge.
 */
function invokeExtensionAction<T>(action: string, payload: Record<string, any>, timeoutMs = 4000): Promise<T> {
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
 * Opens the government portal in a Chrome tab, or reuses an existing tab if already open.
 * Returns tabId, windowId, and reuse status.
 */
export async function openGovernmentForm(
  url: string,
  sessionId?: string,
  timeoutMs = 4500
): Promise<OpenGovernmentFormResult> {
  try {
    const res = await invokeExtensionAction<OpenGovernmentFormResult>(
      'OPEN_GOVERNMENT_FORM',
      { url, sessionId },
      timeoutMs
    );
    return res;
  } catch (err: any) {
    return {
      success: false,
      error: 'EXTENSION_UNAVAILABLE',
      message: err.message || 'SmartForm AI Chrome Extension is not reachable.',
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
  timeoutMs = 3500
): Promise<FocusFormTabResult> {
  try {
    const res = await invokeExtensionAction<FocusFormTabResult>(
      'FOCUS_FORM_TAB',
      {
        tabId: params.targetTabId,
        windowId: params.targetWindowId,
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
 * Never reduces the URL to domain root or homepage.
 */
export async function reopenGovernmentForm(
  params: { url: string; sessionId?: string },
  timeoutMs = 4500
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
  try {
    const res = await invokeExtensionAction<AutofillFormResult>(
      'AUTOFILL_FORM',
      {
        sessionId: params.sessionId,
        targetTabId: params.targetTabId,
        targetWindowId: params.targetWindowId,
        mappings: params.mappings,
      },
      timeoutMs
    );
    return res;
  } catch (err: any) {
    return {
      success: false,
      filledCount: 0,
      filledFields: [],
      manualFields: [],
      error: 'AUTOFILL_COMMUNICATION_FAILED',
      message: err.message || 'Failed to communicate auto-fill command to Chrome extension.',
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
        tabId: params.targetTabId,
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
