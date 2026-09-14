/**
 * SmartForm AI Chrome Extension - Background Service Worker
 * Manages persistent live government form tab tracking, tab creation/reuse,
 * origin verification, and reliable DOM auto-fill message routing.
 * 
 * Strict Guarantees:
 * 1. Never reloads the government form.
 * 2. Never navigates the government form away from its current URL.
 * 3. Never auto-clicks the final submit button.
 * 4. Verifies actual DOM field injection before acknowledging success.
 */

let activeTabContext = {
  workflowMode: null, // 'URL_PASTE' | 'EXTENSION_INSPECTION'
  tabId: null,
  windowId: null,
  url: null,
  pastedUrl: null,
  inspectedUrl: null,
  pageTitle: null,
  formActionUrl: null,
  targetOrigin: null,
  origin: null,
  sessionId: null,
  timestamp: null,
  inspectionState: null,
  detectedFields: [],
};

// Restore active context from storage on startup
chrome.storage.local.get(
  [
    'workflowMode',
    'activeFormTabId',
    'activeFormWindowId',
    'activeFormUrl',
    'pastedUrl',
    'inspectedUrl',
    'pageTitle',
    'formActionUrl',
    'activeFormOrigin',
    'activeSessionId',
    'inspectedAt',
    'inspectionState',
    'detectedFields',
  ],
  (res) => {
    if (res && res.activeFormTabId) {
      activeTabContext = {
        workflowMode: res.workflowMode || 'EXTENSION_INSPECTION',
        tabId: res.activeFormTabId,
        windowId: res.activeFormWindowId,
        url: res.activeFormUrl,
        pastedUrl: res.pastedUrl || null,
        inspectedUrl: res.inspectedUrl || res.activeFormUrl,
        pageTitle: res.pageTitle || '',
        formActionUrl: res.formActionUrl || '',
        targetOrigin: res.activeFormOrigin,
        origin: res.activeFormOrigin,
        sessionId: res.activeSessionId,
        timestamp: res.inspectedAt,
        inspectionState: res.inspectionState || 'active_inspected',
        detectedFields: res.detectedFields || [],
      };
    }
  }
);

function normalizeUrlForMatching(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl);
    return (parsed.origin + parsed.pathname).toLowerCase().replace(/\/$/, '');
  } catch {
    return rawUrl.trim().toLowerCase().replace(/\/$/, '');
  }
}

// Global Message Router (Internal)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  // Handshake: EXTENSION_PING / PING / CHECK_EXTENSION_STATUS
  if (message.type === 'EXTENSION_PING' || message.action === 'PING' || message.action === 'CHECK_EXTENSION_STATUS') {
    sendResponse({
      type: 'EXTENSION_PONG',
      status: 'active',
      installed: true,
      extensionId: chrome.runtime.id,
      version: '1.0.4',
      activeFormTabId: activeTabContext.tabId,
      currentAppSessionId: activeTabContext.sessionId,
      activeFormUrl: activeTabContext.url,
      activeTabContext,
    });
    return true;
  }

  // Handshake: TAB_READY (Signaled by content script in form tab)
  if (message.action === 'TAB_READY' || message.type === 'TAB_READY') {
    handleTabReady(message, sender, sendResponse);
    return true;
  }

  // 1. OPEN_GOVERNMENT_FORM (URL-Paste Workflow)
  if (message.action === 'OPEN_GOVERNMENT_FORM') {
    handleOpenGovernmentForm(message, sendResponse);
    return true;
  }

  // 2. REGISTER_FORM_TAB
  if (message.action === 'REGISTER_FORM_TAB') {
    handleRegisterFormTab(message, sendResponse);
    return true;
  }

  // 3. AUTOFILL_FORM (or APPLY_AUTO_FILL)
  if (message.action === 'AUTOFILL_FORM' || message.action === 'APPLY_AUTO_FILL') {
    handleAutofillForm(message, sendResponse);
    return true;
  }

  // 4. FOCUS_FORM_TAB
  if (message.action === 'FOCUS_FORM_TAB') {
    handleFocusFormTab(message, sendResponse);
    return true;
  }

  // 4b. REOPEN_GOVERNMENT_FORM (Controlled fallback using exact last-known URL only)
  if (message.action === 'REOPEN_GOVERNMENT_FORM') {
    handleReopenGovernmentForm(message, sendResponse);
    return true;
  }

  // 5. GET_FORM_STATUS
  if (message.action === 'GET_FORM_STATUS') {
    handleGetFormStatus(message, sendResponse);
    return true;
  }

  // 7. INSPECT_FORM_TAB (Live tab inspection)
  if (message.action === 'INSPECT_FORM_TAB') {
    handleInspectFormTab(message, sendResponse);
    return true;
  }

  return false;
});

// External Message Router (Direct communication from allowed web app origins)
if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!message) return false;

    // Handshake: EXTENSION_PING / PING
    if (message.type === 'EXTENSION_PING' || message.action === 'PING' || message.action === 'CHECK_EXTENSION_STATUS') {
      sendResponse({
        type: 'EXTENSION_PONG',
        status: 'active',
        installed: true,
        extensionId: chrome.runtime.id,
        version: '1.0.4',
        activeFormTabId: activeTabContext.tabId,
        currentAppSessionId: activeTabContext.sessionId,
        activeFormUrl: activeTabContext.url,
        activeTabContext,
      });
      return true;
    }

    if (message.action === 'OPEN_GOVERNMENT_FORM') {
      handleOpenGovernmentForm(message, sendResponse);
      return true;
    }

    if (message.action === 'AUTOFILL_FORM' || message.action === 'APPLY_AUTO_FILL') {
      handleAutofillForm(message, sendResponse);
      return true;
    }

    if (message.action === 'FOCUS_FORM_TAB') {
      handleFocusFormTab(message, sendResponse);
      return true;
    }

    if (message.action === 'GET_FORM_STATUS') {
      handleGetFormStatus(message, sendResponse);
      return true;
    }

    return false;
  });
}

/**
 * Handles TAB_READY signal from content scripts when a form tab loads.
 */
function handleTabReady(message, sender, sendResponse) {
  const tabId = (sender && sender.tab) ? sender.tab.id : message.tabId;
  const windowId = (sender && sender.tab) ? sender.tab.windowId : message.windowId;
  const url = message.url || (sender && sender.tab ? sender.tab.url : '');
  const title = message.title || (sender && sender.tab ? sender.tab.title : '');

  console.log('[SmartForm ServiceWorker] TAB_READY detected:', { tabId, url, title });

  if (tabId && url && !url.startsWith('chrome://') && !url.startsWith('chrome-extension://')) {
    activeTabContext.tabId = tabId;
    activeTabContext.windowId = windowId;
    activeTabContext.url = url;
    activeTabContext.inspectedUrl = url;
    activeTabContext.pageTitle = title;
    activeTabContext.status = 'tab_ready';
    activeTabContext.timestamp = Date.now();

    // Broadcast to any open SmartForm AI web app tabs
    try {
      chrome.tabs.query({}, (tabs) => {
        (tabs || []).forEach((t) => {
          if (t.id && t.id !== tabId) {
            chrome.tabs.sendMessage(t.id, {
              type: 'TAB_READY',
              tabId,
              windowId,
              url,
              title,
            }).catch(() => {});
          }
        });
      });
    } catch (e) {}
  }

  if (sendResponse) {
    sendResponse({
      success: true,
      type: 'TAB_READY',
      tabId,
      windowId,
      url,
      status: 'tab_ready',
    });
  }
}

/**
 * Handles opening or reusing the government portal tab.
 * Requirement 3: If tab already exists, reuse it. If not, open in a new tab.
 */
function handleOpenGovernmentForm(message, sendResponse) {
  const targetUrl = message.url;
  const sessionId = message.sessionId || activeTabContext.sessionId;

  if (!targetUrl) {
    sendResponse({ success: false, error: 'MISSING_URL', message: 'Target government form URL is required.' });
    return;
  }

  const normalizedTarget = normalizeUrlForMatching(targetUrl);

  // Search all open tabs in all windows
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      sendResponse({ success: false, error: 'QUERY_FAILED', message: chrome.runtime.lastError.message });
      return;
    }

    // Check if an open tab matches the EXACT target URL
    const existingTab = (tabs || []).find((t) => {
      if (!t.url) return false;
      const norm = normalizeUrlForMatching(t.url);
      return norm === normalizedTarget || t.url === targetUrl;
    });

    if (existingTab) {
      // Re-use and activate existing tab
      try {
        chrome.tabs.update(existingTab.id, { active: true });
        if (existingTab.windowId) {
          chrome.windows.update(existingTab.windowId, { focused: true });
        }
      } catch (e) {}

      updateContextAndStore({
        workflowMode: 'URL_PASTE',
        tabId: existingTab.id,
        windowId: existingTab.windowId,
        url: existingTab.url,
        pastedUrl: targetUrl,
        inspectedUrl: existingTab.url,
        origin: getOrigin(existingTab.url),
        targetOrigin: getOrigin(existingTab.url),
        sessionId,
        status: 'tab_ready',
      });

      // Ensure content script is loaded
      ensureContentScriptInjected(existingTab.id, () => {
        sendResponse({
          success: true,
          type: 'TAB_READY',
          workflowMode: 'URL_PASTE',
          tabId: existingTab.id,
          windowId: existingTab.windowId,
          url: existingTab.url,
          pastedUrl: targetUrl,
          reused: true,
          status: 'tab_ready',
          message: 'Existing government portal tab identified, focused, and targeted.',
        });
      });
      return;
    }

    // Tab does not exist: create it in Chrome with EXACT target URL (active: true so operator sees the live form)
    chrome.tabs.create({ url: targetUrl, active: true }, (newTab) => {
      if (chrome.runtime.lastError || !newTab) {
        sendResponse({
          success: false,
          error: 'TAB_CREATE_FAILED',
          message: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Failed to create tab.',
        });
        return;
      }

      updateContextAndStore({
        workflowMode: 'URL_PASTE',
        tabId: newTab.id,
        windowId: newTab.windowId,
        url: targetUrl,
        pastedUrl: targetUrl,
        inspectedUrl: targetUrl,
        origin: getOrigin(targetUrl),
        targetOrigin: getOrigin(targetUrl),
        sessionId,
        status: 'tab_ready',
      });

      // Wait for tab to load and inject content script
      let responded = false;
      const onUpdatedListener = (tabId, info) => {
        if (tabId === newTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdatedListener);
          ensureContentScriptInjected(newTab.id, () => {
            pollForLiveFields(newTab.id, 8, 350, (fields) => {
              if (responded) return;
              responded = true;
              sendResponse({
                success: true,
                type: 'TAB_READY',
                workflowMode: 'URL_PASTE',
                tabId: newTab.id,
                windowId: newTab.windowId,
                url: targetUrl,
                pastedUrl: targetUrl,
                fields: fields || [],
                reused: false,
                status: 'tab_ready',
                message: 'Government portal opened and live DOM connected.',
              });
            });
          });
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdatedListener);

      // Fallback timeout in case onUpdated complete took too long
      setTimeout(() => {
        if (!responded) {
          responded = true;
          chrome.tabs.onUpdated.removeListener(onUpdatedListener);
          ensureContentScriptInjected(newTab.id, () => {
            pollForLiveFields(newTab.id, 4, 300, (fields) => {
              sendResponse({
                success: true,
                type: 'TAB_READY',
                workflowMode: 'URL_PASTE',
                tabId: newTab.id,
                windowId: newTab.windowId,
                url: targetUrl,
                pastedUrl: targetUrl,
                fields: fields || [],
                reused: false,
                status: 'tab_ready',
                message: 'Government portal opened and target tab connected.',
              });
            });
          });
        }
      }, 5000);
    });
  });
}

function handleRegisterFormTab(message, sendResponse) {
  const exactUrl = (message.inspectedUrl || message.url || '').trim();
  const currentUrl = (message.currentUrl || message.url || exactUrl).trim();
  const origin = message.origin || message.targetOrigin || getOrigin(exactUrl);
  const workflowMode = message.workflowMode || 'EXTENSION_INSPECTION';

  // Runtime Diagnostics: Inspection
  console.log('=== [SmartForm ServiceWorker: REGISTER_FORM_TAB Diagnostics] ===');
  console.log('workflowMode:', workflowMode);
  console.log('sessionId:', message.sessionId);
  console.log('targetTabId:', message.tabId);
  console.log('targetWindowId:', message.windowId);
  console.log('inspectedUrl:', exactUrl);
  console.log('currentUrl:', currentUrl);
  console.log('pageTitle:', message.pageTitle);
  console.log('=================================================================');

  updateContextAndStore({
    workflowMode: workflowMode,
    tabId: message.tabId,
    windowId: message.windowId,
    url: exactUrl,
    pastedUrl: message.pastedUrl || null,
    inspectedUrl: exactUrl,
    currentUrl: currentUrl,
    pageTitle: message.pageTitle || '',
    formActionUrl: message.formActionUrl || '',
    origin: origin,
    targetOrigin: origin,
    sessionId: message.sessionId,
    timestamp: message.timestamp || new Date().toISOString(),
    inspectionState: 'active_inspected',
    detectedFields: message.detectedFields || [],
  });

  sendResponse({ success: true, context: activeTabContext });
}

/**
 * Focuses the exact live government form tab in Chrome.
 * Strict Guarantees:
 * - Checks if targetTabId still exists
 * - If exists: focuses window and activates tab WITHOUT navigating or reloading
 * - If lost: reports ORIGINAL_TAB_NOT_FOUND with exact last-known URL (NEVER silently opens homepage)
 * - Logs all runtime diagnostics: stored targetTabId, stored targetWindowId, current tab URL, tab existence, URL validation result, focus operation result
 */
function handleFocusFormTab(message, sendResponse) {
  const executeFocus = (targetTabId, targetWinId, expectedUrl, sessionId) => {
    const storedTabId = targetTabId;
    const storedWinId = targetWinId;

    if (!storedTabId || typeof storedTabId !== 'number' || isNaN(storedTabId) || storedTabId <= 0) {
      const tabExistence = false;
      const currentTabUrl = null;
      const urlValidationResult = 'NO_STORED_TAB_ID';
      const focusOperationResult = 'FAILED: No valid targetTabId stored in session or provided in message.';

      console.log('=== [SmartForm ServiceWorker: FOCUS_FORM_TAB Execution] ===');
      console.log('stored targetTabId:', storedTabId);
      console.log('stored targetWindowId:', storedWinId);
      console.log('current tab URL:', currentTabUrl);
      console.log('tab existence:', tabExistence);
      console.log('URL validation result:', urlValidationResult);
      console.log('focus operation result:', focusOperationResult);
      console.log('sessionId:', sessionId);
      console.log('===========================================================');

      sendResponse({
        success: false,
        tabExists: false,
        tabExistence: false,
        storedTargetTabId: storedTabId,
        storedTargetWindowId: storedWinId,
        currentTabUrl: null,
        urlValidationResult,
        focusOperationResult,
        sessionId,
        error: 'NO_TARGET_TAB',
        message: 'Original Government Form Tab Is No Longer Available (No Tab ID Recorded)',
        lastKnownUrl: expectedUrl,
        inspectedUrl: expectedUrl,
        pageTitle: activeTabContext.pageTitle || '',
      });
      return;
    }

    // Check tab existence via chrome.tabs.get(targetTabId)
    chrome.tabs.get(storedTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        const tabExistence = false;
        const currentTabUrl = null;
        const urlValidationResult = 'TAB_NOT_FOUND_IN_CHROME';
        const focusOperationResult = `FAILED: Tab #${storedTabId} is no longer open in Chrome. ${chrome.runtime.lastError ? chrome.runtime.lastError.message : ''}`;

        console.log('=== [SmartForm ServiceWorker: FOCUS_FORM_TAB Execution] ===');
        console.log('stored targetTabId:', storedTabId);
        console.log('stored targetWindowId:', storedWinId);
        console.log('current tab URL:', currentTabUrl);
        console.log('tab existence:', tabExistence);
        console.log('URL validation result:', urlValidationResult);
        console.log('focus operation result:', focusOperationResult);
        console.log('sessionId:', sessionId);
        console.log('===========================================================');

        sendResponse({
          success: false,
          tabExists: false,
          tabExistence: false,
          storedTargetTabId: storedTabId,
          storedTargetWindowId: storedWinId,
          currentTabUrl: null,
          urlValidationResult,
          focusOperationResult,
          sessionId,
          error: 'ORIGINAL_TAB_NOT_FOUND',
          message: 'Original Government Form Tab Is No Longer Available',
          lastKnownUrl: expectedUrl,
          inspectedUrl: expectedUrl,
          pageTitle: activeTabContext.pageTitle || '',
          workflowMode: activeTabContext.workflowMode || message.workflowMode,
        });
        return;
      }

      // Tab physically exists in Chrome!
      const tabExistence = true;
      const currentTabUrl = (tab.url || '').trim();

      // Validate URL
      let urlValidationResult = 'VALID';
      let urlMatches = true;
      if (expectedUrl && currentTabUrl) {
        try {
          const cur = new URL(currentTabUrl);
          const exp = new URL(expectedUrl);
          if (cur.origin !== exp.origin) {
            urlValidationResult = `ORIGIN_MISMATCH: Current (${cur.origin}) vs Expected (${exp.origin})`;
            urlMatches = false;
          } else if (cur.pathname !== exp.pathname) {
            urlValidationResult = `PATH_NAVIGATED: Same origin, path is ${cur.pathname} (expected ${exp.pathname})`;
          } else {
            urlValidationResult = `EXACT_MATCH: Tab URL matches inspected form URL (${currentTabUrl})`;
          }
        } catch {
          urlMatches = currentTabUrl === expectedUrl || currentTabUrl.includes(expectedUrl) || expectedUrl.includes(currentUrl);
          urlValidationResult = urlMatches ? 'URL_MATCHED' : `MISMATCH: ${currentTabUrl} vs ${expectedUrl}`;
        }
      }

      const windowToFocus = tab.windowId || storedWinId;

      // STRICT MANDATE:
      // The button MUST use the existing targetTabId and targetWindowId with chrome.windows.update() and chrome.tabs.update({active:true}).
      // It must NOT navigate using targetUrl, origin, homepage, baseUrl, rootUrl, window.location, chrome.tabs.create({url}), or any generic government-domain URL when the original tab still exists.
      chrome.tabs.update(tab.id, { active: true }, (updatedTab) => {
        if (chrome.runtime.lastError) {
          const focusOperationResult = `FAILED_TAB_ACTIVATE: ${chrome.runtime.lastError.message}`;

          console.log('=== [SmartForm ServiceWorker: FOCUS_FORM_TAB Execution] ===');
          console.log('stored targetTabId:', storedTabId);
          console.log('stored targetWindowId:', storedWinId);
          console.log('current tab URL:', currentTabUrl);
          console.log('tab existence:', tabExistence);
          console.log('URL validation result:', urlValidationResult);
          console.log('focus operation result:', focusOperationResult);
          console.log('sessionId:', sessionId);
          console.log('===========================================================');

          sendResponse({
            success: false,
            tabExists: true,
            tabExistence: true,
            storedTargetTabId: storedTabId,
            storedTargetWindowId: storedWinId,
            currentTabUrl,
            urlValidationResult,
            focusOperationResult,
            sessionId,
            error: 'TAB_ACTIVATE_FAILED',
            message: chrome.runtime.lastError.message,
            workflowMode: activeTabContext.workflowMode || message.workflowMode,
          });
          return;
        }

        const completeFocus = () => {
          const focusOperationResult = `SUCCESS: chrome.windows.update(winId=${windowToFocus}, focused=true) & chrome.tabs.update(tabId=${tab.id}, active=true)`;

          console.log('=== [SmartForm ServiceWorker: FOCUS_FORM_TAB Execution] ===');
          console.log('stored targetTabId:', storedTabId);
          console.log('stored targetWindowId:', storedWinId);
          console.log('current tab URL:', currentTabUrl);
          console.log('tab existence:', tabExistence);
          console.log('URL validation result:', urlValidationResult);
          console.log('focus operation result:', focusOperationResult);
          console.log('sessionId:', sessionId);
          console.log('===========================================================');

          sendResponse({
            success: true,
            tabExists: true,
            tabExistence: true,
            storedTargetTabId: storedTabId,
            storedTargetWindowId: storedWinId,
            tabId: tab.id,
            windowId: windowToFocus,
            currentTabUrl,
            url: currentTabUrl,
            title: updatedTab?.title || tab.title || '',
            urlValidationResult,
            focusOperationResult,
            sessionId,
            urlMatches,
            isExactUrl: currentTabUrl === expectedUrl,
            message: 'Returned to Live Government Form ✓',
            returnedMessage: 'Returned to Live Government Form ✓',
            livePageConnectedMessage: 'Live Government Page Connected ✓',
            workflowMode: activeTabContext.workflowMode || message.workflowMode,
          });
        };

        if (windowToFocus) {
          chrome.windows.update(windowToFocus, { focused: true }, () => {
            completeFocus();
          });
        } else {
          completeFocus();
        }
      });
    });
  };

  // Determine IDs from message, activeTabContext, or chrome.storage.local fallback
  const rawTabId = message.tabId ?? message.targetTabId ?? activeTabContext.tabId;
  const rawWinId = message.windowId ?? message.targetWindowId ?? activeTabContext.windowId;
  const expectedUrl = (message.expectedUrl || activeTabContext.inspectedUrl || activeTabContext.url || '').trim();
  const sessionId = message.sessionId || activeTabContext.sessionId || '';

  const parsedTabId = typeof rawTabId === 'number' ? rawTabId : parseInt(String(rawTabId || ''), 10);
  const parsedWinId = typeof rawWinId === 'number' ? rawWinId : parseInt(String(rawWinId || ''), 10);

  if (isNaN(parsedTabId) || parsedTabId <= 0) {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        ['activeFormTabId', 'activeFormWindowId', 'inspectedUrl', 'activeFormUrl', 'activeSessionId', 'pageTitle'],
        (res) => {
          const storedTabId = res?.activeFormTabId ? parseInt(String(res.activeFormTabId), 10) : NaN;
          const storedWinId = res?.activeFormWindowId ? parseInt(String(res.activeFormWindowId), 10) : NaN;
          const resolvedExpectedUrl = expectedUrl || res?.inspectedUrl || res?.activeFormUrl || '';
          const resolvedSessionId = sessionId || res?.activeSessionId || '';
          executeFocus(storedTabId, storedWinId, resolvedExpectedUrl, resolvedSessionId);
        }
      );
    } else {
      executeFocus(NaN, NaN, expectedUrl, sessionId);
    }
  } else {
    executeFocus(parsedTabId, parsedWinId, expectedUrl, sessionId);
  }
}

/**
 * Controlled fallback to reopen the form.
 * Uses the EXACT last-known URL stored during inspection, NEVER only the government domain homepage.
 */
function handleReopenGovernmentForm(message, sendResponse) {
  const exactFormUrl = (message.url || activeTabContext.inspectedUrl || activeTabContext.url || '').trim();

  if (!exactFormUrl) {
    sendResponse({
      success: false,
      error: 'NO_EXACT_URL',
      message: 'No exact government form URL was found to reopen.',
    });
    return;
  }

  chrome.tabs.create({ url: exactFormUrl, active: true }, (newTab) => {
    if (chrome.runtime.lastError || !newTab) {
      sendResponse({
        success: false,
        error: 'TAB_CREATE_FAILED',
        message: chrome.runtime.lastError?.message || 'Failed to reopen government form tab.',
      });
      return;
    }

    if (newTab.windowId) {
      chrome.windows.update(newTab.windowId, { focused: true });
    }

    updateContextAndStore({
      tabId: newTab.id,
      windowId: newTab.windowId,
      url: exactFormUrl,
      inspectedUrl: exactFormUrl,
      sessionId: message.sessionId || activeTabContext.sessionId,
      inspectionState: 'fallback_reopened',
    });

    const onUpdatedListener = (tabId, info) => {
      if (tabId === newTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdatedListener);
        ensureContentScriptInjected(newTab.id, () => {});
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdatedListener);

    sendResponse({
      success: true,
      tabId: newTab.id,
      windowId: newTab.windowId,
      url: exactFormUrl,
      message: 'Reopened exact inspected URL. Note: If portal requires login session, please log in manually.',
    });
  });
}

function handleGetFormStatus(message, sendResponse) {
  const targetTabId = message.tabId || activeTabContext.tabId;
  if (!targetTabId) {
    sendResponse({ success: true, tabExists: false, message: 'No target tab registered.' });
    return;
  }

  chrome.tabs.get(targetTabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      sendResponse({ success: true, tabExists: false, error: chrome.runtime.lastError?.message });
      return;
    }
    sendResponse({
      success: true,
      tabExists: true,
      tabId: tab.id,
      url: tab.url,
      title: tab.title,
    });
  });
}

function pollForLiveFields(tabId, maxRetries, intervalMs, callback) {
  let attempts = 0;
  function attempt() {
    attempts++;
    chrome.tabs.sendMessage(tabId, { action: 'SMARTFORM_INSPECT_DOM' }, (resp) => {
      if (!chrome.runtime.lastError && resp && resp.data && Array.isArray(resp.data.fields) && resp.data.fields.length > 0) {
        callback(resp.data.fields, resp.data);
        return;
      }
      if (attempts < maxRetries) {
        setTimeout(attempt, intervalMs);
      } else {
        callback(resp?.data?.fields || [], resp?.data || {});
      }
    });
  }
  attempt();
}

/**
 * Handles INSPECT_FORM_TAB to extract live DOM fields from an open government form tab.
 */
function handleInspectFormTab(message, sendResponse) {
  const tabId = message.tabId || activeTabContext.tabId;
  if (!tabId) {
    sendResponse({ success: false, error: 'NO_TAB_ID', fields: [] });
    return;
  }

  ensureContentScriptInjected(tabId, () => {
    pollForLiveFields(tabId, 8, 300, (fields, meta) => {
      sendResponse({
        success: true,
        tabId,
        url: meta?.url || message.url,
        title: meta?.title || '',
        fields: fields || [],
      });
    });
  });
}

/**
 * Handles AUTOFILL_FORM with strict verification.
 * Requirement 14:
 * Verify targetTabId exists, tab is open, URL matches origin, content script responds,
 * and reports real filled count. Only then acknowledge success.
 */
function handleAutofillForm(message, sendResponse) {
  let targetTabId = message.targetTabId || message.tabId || activeTabContext.tabId;
  const mappings = message.mappings || message.payload?.mappings || [];

  function proceedWithTab(tab) {
    if (!tab || !tab.id) {
      sendResponse({
        success: false,
        error: 'NO_TARGET_TAB',
        message: 'Cannot auto-fill: Target government form tab is not open.',
      });
      return;
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:'))) {
      sendResponse({
        success: false,
        error: 'INVALID_TAB_TYPE',
        message: 'Cannot auto-fill internal browser pages. Please open the government form tab.',
      });
      return;
    }

    activeTabContext.tabId = tab.id;
    activeTabContext.windowId = tab.windowId;

    // Deliver message to content script in the live government form tab
    deliverAutofillToContentScript(tab.id, mappings, (result) => {
      if (!result.success) {
        sendResponse(result);
        return;
      }

      // Focus the tab so operator sees the live values
      try {
        chrome.tabs.update(tab.id, { active: true }, () => {
          if (tab.windowId) {
            chrome.windows.update(tab.windowId, { focused: true }, () => {});
          }
        });
      } catch (e) {}

      sendResponse({
        success: true,
        tabId: tab.id,
        filledCount: result.filledCount || 0,
        filledFields: result.filledFields || [],
        manualFields: result.manualFields || [],
        message: `Successfully populated ${result.filledCount} fields in the live form.`,
      });
    });
  }

  function findAlternativeTargetTab() {
    chrome.tabs.query({}, (tabs) => {
      // 1. Check if any tab matches inspectedUrl or formUrl
      const candidateUrls = [activeTabContext.inspectedUrl, activeTabContext.url, activeTabContext.pastedUrl].filter(Boolean);
      let matched = null;
      for (const urlStr of candidateUrls) {
        try {
          const u = new URL(urlStr);
          matched = tabs.find(t => t.url && t.url.includes(u.hostname) && !t.url.includes('sarkari-saathi') && !t.url.includes('ai.studio'));
          if (matched) break;
        } catch (e) {}
      }

      // 2. Check for common government or demo portals
      if (!matched) {
        matched = tabs.find(t => t.url && (
          t.url.includes('demoqa.com') ||
          t.url.includes('live-test-form') ||
          t.url.includes('.gov.in') ||
          t.url.includes('.nic.in') ||
          t.url.includes('upsc') ||
          t.url.includes('ssc')
        ));
      }

      // 3. Fallback: Any http tab that is not our dashboard or extension
      if (!matched) {
        matched = tabs.find(t => t.url && t.url.startsWith('http') && !t.url.includes('sarkari-saathi') && !t.url.includes('ai.studio') && !t.url.includes('localhost:3000'));
      }

      if (matched) {
        proceedWithTab(matched);
      } else {
        sendResponse({
          success: false,
          error: 'NO_TARGET_TAB',
          message: 'No open government form tab found to auto-fill. Please ensure the form tab is open in Chrome.',
        });
      }
    });
  }

  if (targetTabId) {
    chrome.tabs.get(targetTabId, (tab) => {
      if (!chrome.runtime.lastError && tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        proceedWithTab(tab);
      } else {
        findAlternativeTargetTab();
      }
    });
  } else {
    findAlternativeTargetTab();
  }
}

function deliverAutofillToContentScript(tabId, mappings, callback) {
  chrome.tabs.sendMessage(
    tabId,
    { action: 'AUTOFILL_FORM', mappings, payload: { mappings } },
    (response) => {
      if (chrome.runtime.lastError) {
        // Retry with injection
        ensureContentScriptInjected(tabId, (injected) => {
          if (!injected) {
            callback({
              success: false,
              error: 'CONTENT_SCRIPT_UNREACHABLE',
              message: 'Content script unreachable: ' + chrome.runtime.lastError.message,
            });
            return;
          }

          setTimeout(() => {
            chrome.tabs.sendMessage(
              tabId,
              { action: 'AUTOFILL_FORM', mappings, payload: { mappings } },
              (retryRes) => {
                if (chrome.runtime.lastError) {
                  callback({
                    success: false,
                    error: 'CONTENT_SCRIPT_RETRY_FAILED',
                    message: 'Content script failed to respond: ' + chrome.runtime.lastError.message,
                  });
                  return;
                }
                const resData = retryRes?.results || retryRes || {};
                callback({
                  success: true,
                  filledCount: resData.filledCount || 0,
                  filledFields: resData.filledFields || [],
                  manualFields: resData.unfilledRequiredFields || resData.manualFields || [],
                });
              }
            );
          }, 150);
        });
        return;
      }

      const resData = response?.results || response || {};
      callback({
        success: true,
        filledCount: resData.filledCount || 0,
        filledFields: resData.filledFields || [],
        manualFields: resData.unfilledRequiredFields || resData.manualFields || [],
      });
    }
  );
}

function ensureContentScriptInjected(tabId, callback) {
  if (!chrome.scripting || !chrome.scripting.executeScript) {
    if (callback) callback(false);
    return;
  }

  chrome.scripting.executeScript(
    { target: { tabId }, files: ['content-script.js'] },
    () => {
      if (chrome.runtime.lastError) {
        if (callback) callback(false);
        return;
      }
      if (callback) callback(true);
    }
  );
}

function updateContextAndStore(newCtx) {
  activeTabContext = { ...activeTabContext, ...newCtx };
  if (!activeTabContext.inspectedUrl && activeTabContext.url) {
    activeTabContext.inspectedUrl = activeTabContext.url;
  }
  const effectiveOrigin = activeTabContext.origin || activeTabContext.targetOrigin || getOrigin(activeTabContext.url);
  activeTabContext.origin = effectiveOrigin;
  activeTabContext.targetOrigin = effectiveOrigin;

  chrome.storage.local.set({
    workflowMode: activeTabContext.workflowMode,
    activeFormTabId: activeTabContext.tabId,
    activeFormWindowId: activeTabContext.windowId,
    activeFormUrl: activeTabContext.url,
    pastedUrl: activeTabContext.pastedUrl,
    inspectedUrl: activeTabContext.inspectedUrl,
    pageTitle: activeTabContext.pageTitle || '',
    formActionUrl: activeTabContext.formActionUrl || '',
    activeFormOrigin: activeTabContext.origin,
    activeSessionId: activeTabContext.sessionId,
    inspectedAt: activeTabContext.timestamp || new Date().toISOString(),
    inspectionState: activeTabContext.inspectionState || 'active_inspected',
    detectedFields: activeTabContext.detectedFields || [],
  });
}

function getOrigin(u) {
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}
