/**
 * SmartForm AI - Operator Extension Popup Script
 * Persists custom server URLs in chrome.storage.local.
 * Communicates with backend /api/forms/analyze and opens dashboard at configured URL.
 */

const DEFAULT_SERVER_URL = 'https://sarkari-saathi.ai.studio';

document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrlInput');
  const saveServerBtn = document.getElementById('saveServerBtn');
  const serverStatus = document.getElementById('serverStatus');
  const saveFeedback = document.getElementById('saveFeedback');
  const currentTabTitle = document.getElementById('currentTabTitle');
  const currentTabUrl = document.getElementById('currentTabUrl');
  const alertBox = document.getElementById('alertBox');
  const inspectBtn = document.getElementById('inspectBtn');
  const openAppBtn = document.getElementById('openAppBtn');
  const resultBox = document.getElementById('resultBox');
  const fieldCount = document.getElementById('fieldCount');
  const fieldList = document.getElementById('fieldList');

  // 1. Initialize Server URL from chrome.storage.local
  function isObsoleteOrLocalAddress(raw) {
    if (!raw || typeof raw !== 'string') return true;
    if (raw.includes('your-public-service')) return true;
    try {
      new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      return false;
    } catch {
      return true;
    }
  }

  function sanitizeServerUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string' || isObsoleteOrLocalAddress(rawUrl)) {
      return DEFAULT_SERVER_URL;
    }
    return rawUrl.trim().replace(/\/$/, '');
  }

  function getEffectiveServerUrl(callback) {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['serverUrl'], (res) => {
        const stored = res && res.serverUrl;
        const url = sanitizeServerUrl(stored);
        if (stored && stored === url) {
          callback(url);
        } else if (stored && isObsoleteOrLocalAddress(stored)) {
          chrome.storage.local.set({ serverUrl: DEFAULT_SERVER_URL });
          callback(DEFAULT_SERVER_URL);
        } else {
          callback(url);
        }
      });
    } else {
      callback(DEFAULT_SERVER_URL);
    }
  }

  function checkServerHealth(url) {
    serverStatus.className = 'status-dot';
    serverStatus.title = 'Checking server connection...';
    
    fetch(`${url}/api/health`, { method: 'GET' })
      .then((res) => {
        if (res.ok) {
          serverStatus.className = 'status-dot online';
          serverStatus.title = `Connected to ${url}`;
        } else {
          serverStatus.className = 'status-dot offline';
          serverStatus.title = `Server returned status ${res.status}`;
        }
      })
      .catch(() => {
        serverStatus.className = 'status-dot offline';
        serverStatus.title = `Could not reach ${url}`;
      });
  }

  getEffectiveServerUrl((url) => {
    serverUrlInput.value = url;
    checkServerHealth(url);
  });

  // 2. Save Server URL setting
  function saveCurrentServerUrl() {
    let raw = (serverUrlInput.value || '').trim();
    if (!raw) raw = DEFAULT_SERVER_URL;
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
      raw = 'https://' + raw;
    }
    const cleanUrl = raw.replace(/\/$/, '');
    serverUrlInput.value = cleanUrl;

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ serverUrl: cleanUrl }, () => {
        saveFeedback.classList.remove('hidden');
        saveFeedback.innerText = 'Saved & Verified';
        setTimeout(() => saveFeedback.classList.add('hidden'), 2500);
        checkServerHealth(cleanUrl);
      });
    } else {
      checkServerHealth(cleanUrl);
    }
  }

  saveServerBtn.addEventListener('click', saveCurrentServerUrl);
  serverUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveCurrentServerUrl();
  });

  // 3. Query active tab
  let activeTab = null;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      activeTab = tabs[0];
      currentTabTitle.innerText = activeTab.title || 'Untitled Webpage';
      currentTabUrl.innerText = activeTab.url || '';
    }
  });

  function showAlert(msg) {
    alertBox.innerText = msg;
    alertBox.classList.remove('hidden');
  }

  function hideAlert() {
    alertBox.classList.add('hidden');
  }

  // 4. Check for active session in chrome.storage.local
  const sessionBox = document.getElementById('sessionBox');
  const activeSessionDisplay = document.getElementById('activeSessionDisplay');
  const activeSessionBadge = document.getElementById('activeSessionBadge');
  const activeSessionSummary = document.getElementById('activeSessionSummary');
  const autoFillLiveTabBtn = document.getElementById('autoFillLiveTabBtn');
  const focusTabBtn = document.getElementById('focusTabBtn');

  let currentStoredSessionId = null;
  let storedTargetTabId = null;
  let storedTargetWindowId = null;
  let storedLastUrl = null;
  let storedWorkflowMode = null;

  function loadActiveSession() {
    if (!chrome.storage || !chrome.storage.local) return;

    chrome.storage.local.get(
      ['activeSessionId', 'activeFormTabId', 'activeFormWindowId', 'activeFormUrl', 'inspectedUrl', 'workflowMode'],
      (res) => {
        if (res && res.activeSessionId) {
          currentStoredSessionId = res.activeSessionId;
          storedTargetTabId = res.activeFormTabId;
          storedTargetWindowId = res.activeFormWindowId;
          storedLastUrl = res.inspectedUrl || res.activeFormUrl || null;
          storedWorkflowMode = res.workflowMode || 'EXTENSION_INSPECTION';

          sessionBox.classList.remove('hidden');
          activeSessionDisplay.innerText = `Session: ${res.activeSessionId}`;

          getEffectiveServerUrl((serverUrl) => {
            fetch(`${serverUrl}/api/sessions/${res.activeSessionId}`)
              .then((r) => r.json())
              .then((session) => {
                if (!session || session.error) {
                  activeSessionSummary.innerText = 'Session expired or not found.';
                  return;
                }

                const verifiedDocs = (session.documentRequirements || []).filter(
                  (d) => d.status === 'verified'
                ).length;
                const totalDocs = (session.documentRequirements || []).length;
                const mappingsCount = (session.mappings || []).filter(
                  (m) => m.extractedValue && !m.isManualEntry
                ).length;

                if (mappingsCount > 0 || session.status === 'ready_for_review') {
                  activeSessionBadge.className = 'status-badge ready';
                  activeSessionBadge.innerText = 'Ready to Fill';
                  activeSessionSummary.innerText = `✓ ${verifiedDocs}/${totalDocs} documents verified. ${mappingsCount} fields ready to inject into live DOM.`;
                  autoFillLiveTabBtn.disabled = false;
                } else {
                  activeSessionBadge.className = 'status-badge waiting';
                  activeSessionBadge.innerText = 'Waiting Upload';
                  activeSessionSummary.innerText = `Waiting for applicant to scan QR (${verifiedDocs}/${totalDocs} uploaded).`;
                }
              })
              .catch(() => {
                activeSessionSummary.innerText = 'Could not sync session status with server.';
              });
          });
        }
      }
    );
  }

  loadActiveSession();

  // 5. Direct Live Auto-Fill Button in Popup
  autoFillLiveTabBtn.addEventListener('click', () => {
    hideAlert();
    if (!currentStoredSessionId) {
      showAlert('No active session found.');
      return;
    }

    autoFillLiveTabBtn.disabled = true;
    autoFillLiveTabBtn.innerText = 'Injecting extracted details into live DOM...';

    getEffectiveServerUrl((serverUrl) => {
      fetch(`${serverUrl}/api/sessions/${currentStoredSessionId}`)
        .then((r) => r.json())
        .then((session) => {
          if (!session || !session.mappings) {
            autoFillLiveTabBtn.disabled = false;
            autoFillLiveTabBtn.innerText = '⚡ Auto-Fill Into This Live Tab';
            showAlert('Could not retrieve extracted field mappings.');
            return;
          }

          // Target tab ID is either the registered tab or current active tab
          const targetId = storedTargetTabId || (activeTab ? activeTab.id : null);

          chrome.runtime.sendMessage(
            {
              action: 'APPLY_AUTO_FILL',
              targetTabId: targetId,
              tabId: targetId,
              sessionId: currentStoredSessionId,
              payload: {
                sessionId: currentStoredSessionId,
                mappings: session.mappings,
              },
            },
            (response) => {
              autoFillLiveTabBtn.disabled = false;
              autoFillLiveTabBtn.innerText = '⚡ Auto-Fill Into This Live Tab';

              if (chrome.runtime.lastError || !response || response.status === 'error') {
                const err = response?.message || chrome.runtime.lastError?.message || 'Auto-fill failed';
                showAlert(`Auto-fill error: ${err}`);
                return;
              }

              const resData = response.results || response;
              const filled = resData.filledCount || 0;
              const manual = (resData.manualRequiredFields || []).length;

              activeSessionSummary.innerText = `🎉 Successfully populated ${filled} fields directly into this live tab! (${manual} fields require manual entry).`;
              showAlert(`Live form updated! ${filled} fields filled. Check form and submit manually.`);
            }
          );
        })
        .catch((err) => {
          autoFillLiveTabBtn.disabled = false;
          autoFillLiveTabBtn.innerText = '⚡ Auto-Fill Into This Live Tab';
          showAlert(`Error fetching session: ${err.message}`);
        });
    });
  });

  // 6. Focus Government Form Tab Button
  focusTabBtn.addEventListener('click', () => {
    const targetId = storedTargetTabId || (activeTab ? activeTab.id : null);
    if (targetId) {
      chrome.runtime.sendMessage(
        {
          action: 'FOCUS_FORM_TAB',
          tabId: targetId,
          windowId: storedTargetWindowId,
          expectedUrl: storedLastUrl,
        },
        (res) => {
          if (res && !res.success) {
            showAlert(res.message || 'Original government form tab is no longer open in Chrome.');
          } else if (res && res.success) {
            window.close();
          }
        }
      );
    } else {
      showAlert('No live form tab recorded in this session.');
    }
  });

  // 7. Inspect Government Form & Send to Backend
  inspectBtn.addEventListener('click', async () => {
    hideAlert();
    if (!activeTab || !activeTab.id) {
      showAlert('No active browser tab found.');
      return;
    }

    if (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://')) {
      showAlert('Cannot inspect internal Chrome pages. Please navigate to a government or examination portal.');
      return;
    }

    inspectBtn.disabled = true;
    inspectBtn.innerText = 'Inspecting webpage DOM...';

    // Helper to send message with fallback to script injection
    function executeInspection() {
      chrome.tabs.sendMessage(activeTab.id, { action: 'SMARTFORM_INSPECT_DOM' }, async (response) => {
        if (chrome.runtime.lastError || !response || response.status !== 'success') {
          // If content-script was not yet injected into this tab, inject it and retry once
          if (chrome.scripting && chrome.scripting.executeScript) {
            chrome.scripting.executeScript(
              { target: { tabId: activeTab.id }, files: ['content-script.js'] },
              () => {
                if (chrome.runtime.lastError) {
                  inspectBtn.disabled = false;
                  inspectBtn.innerText = 'Inspect Form & Open Dashboard';
                  showAlert('Could not inspect tab: ' + chrome.runtime.lastError.message);
                  return;
                }
                // Retry after injection
                setTimeout(() => {
                  chrome.tabs.sendMessage(activeTab.id, { action: 'SMARTFORM_INSPECT_DOM' }, (retryRes) => {
                    handleInspectionResult(retryRes);
                  });
                }, 100);
              }
            );
            return;
          }

          inspectBtn.disabled = false;
          inspectBtn.innerText = 'Inspect Form & Open Dashboard';
          showAlert('Could not inspect page. Please refresh the webpage and try again.');
          return;
        }

        handleInspectionResult(response);
      });
    }

    async function handleInspectionResult(response) {
      if (!response || response.status !== 'success' || !response.data) {
        inspectBtn.disabled = false;
        inspectBtn.innerText = 'Inspect Form & Open Dashboard';
        showAlert('No interactive form fields found on this webpage.');
        return;
      }

      const formStructure = response.data;
      resultBox.classList.remove('hidden');
      fieldCount.innerText = formStructure.fields ? formStructure.fields.length : 0;

      if (formStructure.fields && formStructure.fields.length > 0) {
        fieldList.innerHTML = formStructure.fields
          .slice(0, 8)
          .map(
            (f) =>
              `<div class="field-item">
                <span class="field-label">${escapeHtml(f.label || f.name)}</span>
                <span class="field-meta">${f.fieldType} ${f.required ? '(Req)' : ''}</span>
              </div>`
          )
          .join('');
        if (formStructure.fields.length > 8) {
          fieldList.innerHTML += `<div class="field-item" style="color:#64748b; font-style:italic;">+ ${formStructure.fields.length - 8} more fields</div>`;
        }
      }

      inspectBtn.innerText = 'Sending to SmartForm AI...';

      // Send inspected schema to configured server URL
      getEffectiveServerUrl(async (serverUrl) => {
        try {
          const exactCurrentUrl = (activeTab.url || formStructure.url || '').trim();
          const exactPageTitle = activeTab.title || formStructure.title || 'Government Form';
          const formActionUrl = formStructure.formActionUrl || '';
          const tabOrigin = exactCurrentUrl ? new URL(exactCurrentUrl).origin : '';
          const timestamp = new Date().toISOString();

          const res = await fetch(`${serverUrl}/api/forms/analyze`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-SmartForm-Origin': serverUrl,
            },
            body: JSON.stringify({
              workflowMode: 'EXTENSION_INSPECTION',
              formUrl: exactCurrentUrl,
              inspectedUrl: exactCurrentUrl,
              pageTitle: exactPageTitle,
              formActionUrl: formActionUrl,
              detectedFields: formStructure.fields,
              origin: serverUrl,
              targetTabId: activeTab.id,
              targetWindowId: activeTab.windowId,
              targetOrigin: tabOrigin,
              timestamp: timestamp,
            }),
          });

          const data = await res.json();

          if (res.ok && data.sessionId) {
            const currentTabUrlStr = (activeTab.url || exactCurrentUrl).trim();

            // Log inspection runtime diagnostics as required
            console.log('=== [SmartForm Extension: Inspection Runtime Diagnostics] ===');
            console.log('workflowMode: EXTENSION_INSPECTION');
            console.log('sessionId:', data.sessionId);
            console.log('targetTabId:', activeTab.id);
            console.log('targetWindowId:', activeTab.windowId);
            console.log('inspectedUrl:', exactCurrentUrl);
            console.log('currentUrl:', currentTabUrlStr);
            console.log('pageTitle:', exactPageTitle);
            console.log('============================================================');

            // Display inspection runtime diagnostics in extension popup UI
            const diagCard = document.getElementById('inspectionDiagnosticsCard');
            const diagSessionId = document.getElementById('diagSessionId');
            const diagTargetTabId = document.getElementById('diagTargetTabId');
            const diagTargetWindowId = document.getElementById('diagTargetWindowId');
            const diagInspectedUrl = document.getElementById('diagInspectedUrl');
            const diagCurrentUrl = document.getElementById('diagCurrentUrl');
            const diagPageTitle = document.getElementById('diagPageTitle');

            if (diagCard) {
              if (diagSessionId) diagSessionId.innerText = data.sessionId;
              if (diagTargetTabId) diagTargetTabId.innerText = String(activeTab.id);
              if (diagTargetWindowId) diagTargetWindowId.innerText = String(activeTab.windowId);
              if (diagInspectedUrl) diagInspectedUrl.innerText = exactCurrentUrl;
              if (diagCurrentUrl) diagCurrentUrl.innerText = currentTabUrlStr;
              if (diagPageTitle) diagPageTitle.innerText = exactPageTitle;
              diagCard.classList.remove('hidden');
            }

            // Register active government form tab in background service worker
            chrome.runtime.sendMessage({
              action: 'REGISTER_FORM_TAB',
              workflowMode: 'EXTENSION_INSPECTION',
              tabId: activeTab.id,
              windowId: activeTab.windowId,
              url: exactCurrentUrl,
              inspectedUrl: exactCurrentUrl,
              currentUrl: currentTabUrlStr,
              pageTitle: exactPageTitle,
              formActionUrl: formActionUrl,
              origin: tabOrigin,
              targetOrigin: tabOrigin,
              sessionId: data.sessionId,
              timestamp: timestamp,
              inspectionState: 'active_inspected',
              detectedFields: formStructure.fields,
            });

            // Save active session in chrome.storage.local
            if (chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({
                workflowMode: 'EXTENSION_INSPECTION',
                activeSessionId: data.sessionId,
                activeFormTabId: activeTab.id,
                activeFormWindowId: activeTab.windowId,
                activeFormUrl: exactCurrentUrl,
                inspectedUrl: exactCurrentUrl,
                currentUrl: currentTabUrlStr,
                pageTitle: exactPageTitle,
                formActionUrl: formActionUrl,
                activeFormOrigin: tabOrigin,
                lastFormUrl: exactCurrentUrl,
                inspectedAt: timestamp,
                inspectionState: 'active_inspected',
              });
            }

            // Open operator dashboard using the configured server URL with all parameters
            const dashboardUrl = `${serverUrl}/?session=${data.sessionId}&mode=EXTENSION_INSPECTION&url=${encodeURIComponent(exactCurrentUrl)}&inspectedUrl=${encodeURIComponent(exactCurrentUrl)}&tabId=${activeTab.id}&winId=${activeTab.windowId}&title=${encodeURIComponent(exactPageTitle)}`;
            chrome.tabs.create({ url: dashboardUrl });

            inspectBtn.innerText = 'Form Sent! Opening Dashboard...';
            loadActiveSession();
            setTimeout(() => {
              inspectBtn.disabled = false;
              inspectBtn.innerText = 'Inspect Form & Open Dashboard';
            }, 2000);
          } else {
            inspectBtn.disabled = false;
            inspectBtn.innerText = 'Inspect Form & Open Dashboard';
            showAlert('Server error: ' + (data.error || 'Failed to analyze form structure.'));
          }
        } catch (err) {
          inspectBtn.disabled = false;
          inspectBtn.innerText = 'Inspect Form & Open Dashboard';
          showAlert('Network error: Could not reach ' + serverUrl + '. Check server status.');
        }
      });
    }

    executeInspection();
  });

  // 5. Open Operator Dashboard at configured server URL
  openAppBtn.addEventListener('click', () => {
    getEffectiveServerUrl((serverUrl) => {
      chrome.tabs.create({ url: serverUrl });
    });
  });

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[m]);
  }
});
