/**
 * SmartForm AI Chrome Extension - Background Service Worker
 * Manages tab tracking, messaging between Web App and Live Form Content Scripts
 */

// Active target government form tab ID
let activeFormTabId = null;
let currentAppSessionId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'OPEN_GOVERNMENT_FORM') {
    const url = message.url;
    currentAppSessionId = message.sessionId;

    chrome.tabs.create({ url, active: true }, (tab) => {
      activeFormTabId = tab.id;
      sendResponse({ status: 'success', tabId: tab.id });
    });
    return true;
  }

  if (message.action === 'INSPECT_CURRENT_TAB') {
    const targetTabId = message.tabId || activeFormTabId;

    if (!targetTabId) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
          sendResponse({ status: 'error', message: 'No active tab found.' });
          return;
        }
        executeInspect(tabs[0].id, sendResponse);
      });
      return true;
    }

    executeInspect(targetTabId, sendResponse);
    return true;
  }

  if (message.action === 'APPLY_AUTO_FILL') {
    const targetTabId = message.tabId || activeFormTabId;

    if (!targetTabId) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
          sendResponse({ status: 'error', message: 'No active tab found to fill.' });
          return;
        }
        executeAutoFill(tabs[0].id, message.payload, sendResponse);
      });
      return true;
    }

    executeAutoFill(targetTabId, message.payload, sendResponse);
    return true;
  }

  if (message.action === 'CHECK_EXTENSION_STATUS') {
    sendResponse({
      status: 'active',
      activeFormTabId,
      currentAppSessionId,
      version: '1.0.0',
    });
    return true;
  }
});

function executeInspect(tabId, sendResponse) {
  chrome.tabs.sendMessage(tabId, { action: 'SMARTFORM_INSPECT_DOM' }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({
        status: 'error',
        message: 'Could not connect to tab content script. Make sure page is loaded.',
        error: chrome.runtime.lastError.message,
      });
    } else {
      sendResponse(response);
    }
  });
}

function executeAutoFill(tabId, payload, sendResponse) {
  chrome.tabs.sendMessage(tabId, { action: 'SMARTFORM_AUTO_FILL_DOM', payload }, (response) => {
    if (chrome.runtime.lastError) {
      sendResponse({
        status: 'error',
        message: 'Auto-fill messaging failed: ' + chrome.runtime.lastError.message,
      });
    } else {
      sendResponse(response);
    }
  });
}
