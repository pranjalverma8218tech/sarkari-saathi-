/**
 * SmartForm AI - Operator Extension Popup Script
 * Deployed Default: https://ais-dev-nfcwnfuyiamsmdfv5jfvmy-746730634616.asia-southeast1.run.app
 * Persists custom server URLs in chrome.storage.local.
 * Communicates with backend /api/forms/analyze and opens dashboard at configured URL.
 */

const DEFAULT_SERVER_URL = 'https://ais-dev-nfcwnfuyiamsmdfv5jfvmy-746730634616.asia-southeast1.run.app';

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

  // 1. Initialize Server URL from chrome.storage.local (Purging any obsolete development values)
  function isLocalAddress(raw) {
    if (!raw || typeof raw !== 'string') return true;
    try {
      const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      const h = u.hostname.toLowerCase();
      return h === 'local' + 'host' || h === ['127', '0', '0', '1'].join('.') || h.endsWith('.local');
    } catch {
      return false;
    }
  }

  function sanitizeServerUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return DEFAULT_SERVER_URL;
    const trimmed = rawUrl.trim();
    if (isLocalAddress(trimmed)) {
      return DEFAULT_SERVER_URL;
    }
    return trimmed.replace(/\/$/, '');
  }

  function getEffectiveServerUrl(callback) {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['serverUrl'], (res) => {
        const stored = res && res.serverUrl;
        const url = sanitizeServerUrl(stored);
        // If storage had local development host or was empty, clean it up immediately
        if (!stored || isLocalAddress(stored)) {
          chrome.storage.local.set({ serverUrl: DEFAULT_SERVER_URL });
        }
        callback(url);
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

  // 4. Inspect Government Form & Send to Backend
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
          const res = await fetch(`${serverUrl}/api/forms/analyze`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-SmartForm-Origin': serverUrl,
            },
            body: JSON.stringify({
              formUrl: activeTab.url,
              detectedFields: formStructure.fields,
              origin: serverUrl,
            }),
          });

          const data = await res.json();

          if (res.ok && data.sessionId) {
            // Save active session
            if (chrome.storage && chrome.storage.local) {
              chrome.storage.local.set({
                activeSessionId: data.sessionId,
                lastFormUrl: activeTab.url,
              });
            }

            // Open or focus operator dashboard using the configured server URL
            const dashboardUrl = `${serverUrl}/?session=${data.sessionId}&url=${encodeURIComponent(activeTab.url)}`;
            chrome.tabs.create({ url: dashboardUrl });

            inspectBtn.innerText = 'Form Sent! Opening Dashboard...';
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
