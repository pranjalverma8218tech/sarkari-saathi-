/**
 * SmartForm AI Chrome Extension - Content Script
 * Executes in the context of the live webpage.
 * Deep DOM inspector and live auto-fill engine.
 */

// Helper to determine element label
function getFieldLabel(el) {
  // 1. Explicit <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label && label.innerText.trim()) return label.innerText.trim();
  }

  // 2. Enclosing <label>
  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.innerText.trim()) {
    // Clone and remove input text if needed
    return parentLabel.innerText.replace(el.value || '', '').trim();
  }

  // 3. aria-label or aria-labelledby
  if (el.getAttribute('aria-label')) {
    return el.getAttribute('aria-label').trim();
  }
  if (el.getAttribute('aria-labelledby')) {
    const ref = document.getElementById(el.getAttribute('aria-labelledby'));
    if (ref && ref.innerText.trim()) return ref.innerText.trim();
  }

  // 4. Placeholder
  if (el.placeholder && el.placeholder.trim()) {
    return el.placeholder.trim();
  }

  // 5. Table context (e.g. <tr><td>Label</td><td><input></td></tr>)
  const td = el.closest('td');
  if (td && td.previousElementSibling && td.previousElementSibling.innerText.trim()) {
    return td.previousElementSibling.innerText.trim();
  }

  // 6. Fieldset legend or preceding sibling text
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend && legend.innerText.trim()) {
      return legend.innerText.trim();
    }
  }

  // 7. Nearby text
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.innerText && prev.innerText.trim().length > 0 && prev.innerText.trim().length < 60) {
      return prev.innerText.trim();
    }
    prev = prev.previousElementSibling;
  }

  // 8. Fallback to name or id
  return el.name || el.id || 'Unnamed Field';
}

// Generate unique reliable CSS selector
function getSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.name) {
    const type = el.getAttribute('type');
    if (type) {
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"][type="${type}"]`;
    }
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
  }
  return el.tagName.toLowerCase();
}

// Inspect DOM and collect structured representation
function inspectLiveForm() {
  const formElements = Array.from(
    document.querySelectorAll('input, textarea, select')
  );

  const detectedFields = [];

  for (const el of formElements) {
    // Skip hidden inputs and buttons
    const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) {
      continue;
    }

    const fieldType =
      el.tagName.toLowerCase() === 'textarea'
        ? 'textarea'
        : el.tagName.toLowerCase() === 'select'
        ? 'select'
        : type;

    // Collect options if select
    let options = [];
    if (el.tagName.toLowerCase() === 'select') {
      options = Array.from(el.querySelectorAll('option'))
        .map((opt) => opt.text.trim())
        .filter(Boolean);
    }

    const label = getFieldLabel(el);
    const required =
      el.required ||
      el.getAttribute('aria-required') === 'true' ||
      label.includes('*') ||
      el.classList.contains('required');

    detectedFields.push({
      fieldType,
      label: label.replace(/\*/g, '').trim(),
      name: el.name || '',
      id: el.id || '',
      selector: getSelector(el),
      required,
      placeholder: el.placeholder || '',
      autocomplete: el.autocomplete || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      nearbyText: el.parentElement?.innerText?.slice(0, 100) || '',
      options: options.length > 0 ? options : undefined,
      currentValue: el.value || '',
    });
  }

  return {
    url: window.location.href,
    title: document.title,
    domain: window.location.hostname,
    fields: detectedFields,
  };
}

// Set value safely supporting React/Vue/Angular controlled inputs
function setNativeValue(element, value) {
  const isInput = element.tagName.toLowerCase() === 'input';
  const isTextarea = element.tagName.toLowerCase() === 'textarea';
  const isSelect = element.tagName.toLowerCase() === 'select';

  if (isInput || isTextarea) {
    const proto = isInput ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const valueDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    if (valueDescriptor && valueDescriptor.set) {
      valueDescriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    // Trigger synthetic events
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  } else if (isSelect) {
    // Match option by value or text
    let matched = false;
    for (let i = 0; i < element.options.length; i++) {
      const opt = element.options[i];
      if (
        opt.value.toLowerCase() === value.toLowerCase() ||
        opt.text.toLowerCase().includes(value.toLowerCase())
      ) {
        element.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched && element.options.length > 0) {
      element.value = value;
    }
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }
}

// Helper to normalize and format dates for different input types
function normalizeDateValue(value, inputType) {
  if (!value || typeof value !== 'string') return value;
  const clean = value.trim();

  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    if (inputType === 'date') {
      return `${year}-${month}-${day}`; // ISO format for <input type="date">
    }
    return `${day}/${month}/${year}`;
  }

  // Match YYYY-MM-DD
  const ymdMatch = clean.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    if (inputType === 'date') {
      return `${year}-${month}-${day}`;
    }
    return `${day}/${month}/${year}`;
  }

  return clean;
}

// Execute auto-fill from SmartForm AI payload
function executeAutoFill(mappings) {
  const fillResults = {
    filledCount: 0,
    filledFields: [],
    skippedFields: [],
    manualRequiredFields: [],
    manualFileAttachments: [],
  };

  const allInputs = Array.from(document.querySelectorAll('input, textarea, select'));

  for (const mapping of mappings) {
    if (mapping.isManualEntry || !mapping.extractedValue || mapping.status === 'manual_required') {
      fillResults.manualRequiredFields.push(mapping.targetField);
      continue;
    }

    let el = null;

    // 1. Selector match
    if (mapping.targetSelector) {
      try {
        el = document.querySelector(mapping.targetSelector);
      } catch (e) {}
    }

    // 2. ID match
    if (!el && mapping.targetId) {
      el = document.getElementById(mapping.targetId);
    }

    // 3. Name match
    if (!el && mapping.targetName) {
      el = document.querySelector(`[name="${CSS.escape(mapping.targetName)}"]`);
    }

    // 4. Semantic field label / placeholder / aria-label matching
    if (!el) {
      const searchTarget = (mapping.targetField || '').toLowerCase().trim();
      const keyWords = searchTarget.split(/\s+/).filter((w) => w.length > 2);

      // Search all form inputs
      el = allInputs.find((candidate) => {
        const type = (candidate.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset'].includes(type)) return false;

        const label = getFieldLabel(candidate).toLowerCase();
        const placeholder = (candidate.placeholder || '').toLowerCase();
        const ariaLabel = (candidate.getAttribute('aria-label') || '').toLowerCase();
        const name = (candidate.name || '').toLowerCase();
        const id = (candidate.id || '').toLowerCase();

        // Exact match
        if (label === searchTarget || name === searchTarget || id === searchTarget) return true;
        // Contains match
        if (label.includes(searchTarget) || searchTarget.includes(label)) return true;
        // Keywords match
        if (keyWords.length >= 2 && keyWords.every((kw) => label.includes(kw) || name.includes(kw) || placeholder.includes(kw))) {
          return true;
        }
        return false;
      });
    }

    if (el) {
      const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();

      // Check for file input - DO NOT bypass security, show manual requirement banner
      if (type === 'file') {
        fillResults.manualFileAttachments.push({
          field: mapping.targetField,
          documentRequired: mapping.source,
          instruction: `Manual document attachment required: Attach ${mapping.source} here.`,
        });
        el.style.outline = '3px solid #f59e0b';
        el.style.backgroundColor = '#fffbeb';
        el.setAttribute('title', `SmartForm AI: Manual document attachment required for ${mapping.source}`);
        continue;
      }

      // Radio button handling
      if (type === 'radio') {
        const name = el.name;
        const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
        const valLower = mapping.extractedValue.toLowerCase().trim();
        let radioMatched = false;
        for (const radio of radios) {
          const radioLabel = getFieldLabel(radio).toLowerCase().trim();
          if (radio.value.toLowerCase() === valLower || radioLabel === valLower || radioLabel.includes(valLower)) {
            radio.checked = true;
            radio.dispatchEvent(new Event('input', { bubbles: true }));
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('blur', { bubbles: true }));
            radioMatched = true;
            break;
          }
        }
        if (radioMatched) {
          fillResults.filledCount++;
          fillResults.filledFields.push(mapping.targetField);
          continue;
        }
      }

      // Checkbox handling
      if (type === 'checkbox') {
        const valLower = mapping.extractedValue.toLowerCase().trim();
        const shouldCheck = ['true', 'yes', '1', 'checked', 'agree', 'y'].includes(valLower);
        el.checked = shouldCheck;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        fillResults.filledCount++;
        fillResults.filledFields.push(mapping.targetField);
        continue;
      }

      // Input / Textarea / Select handling with date format normalization
      const normalizedValue = normalizeDateValue(mapping.extractedValue, type);
      setNativeValue(el, normalizedValue);

      // Visual feedback: soft green background to clearly indicate auto-filled field
      el.style.backgroundColor = '#ecfdf5';
      el.style.borderColor = '#10b981';
      el.style.transition = 'all 0.4s ease';
      el.setAttribute(
        'title',
        `SmartForm AI: Auto-filled from ${mapping.source} (${Math.round((mapping.confidence || 0.95) * 100)}% confidence)`
      );

      fillResults.filledCount++;
      fillResults.filledFields.push(mapping.targetField);
    } else {
      fillResults.skippedFields.push(mapping.targetField);
    }
  }

  // Scan live page for required fields that remain empty
  const remainingEmptyRequired = [];
  allInputs.forEach((input) => {
    const type = (input.getAttribute('type') || input.tagName.toLowerCase()).toLowerCase();
    if (['hidden', 'submit', 'button', 'reset'].includes(type)) return;

    const label = getFieldLabel(input);
    const isRequired =
      input.required ||
      input.getAttribute('aria-required') === 'true' ||
      label.includes('*') ||
      input.classList.contains('required');

    const hasValue = input.value && input.value.trim().length > 0;
    const isChecked = input.checked;

    if (isRequired && !hasValue && !isChecked) {
      remainingEmptyRequired.push(label.replace(/\*/g, '').trim());
      input.style.borderColor = '#ef4444';
      input.style.borderWidth = '2px';
      input.style.borderStyle = 'solid';
      input.setAttribute('title', 'SmartForm AI: Required field needs operator manual entry');
    }
  });

  fillResults.unfilledRequiredFields = Array.from(new Set(remainingEmptyRequired));

  // Highlight visible submit button WITHOUT clicking it!
  const submitBtns = document.querySelectorAll(
    'input[type="submit"], button[type="submit"], button.submit, form button[type="button"]:last-of-type'
  );
  submitBtns.forEach((btn) => {
    btn.style.boxShadow = '0 0 0 3px #3b82f6, 0 10px 15px -3px rgba(59, 130, 246, 0.2)';
    btn.setAttribute('title', 'SmartForm AI: Review all details above before clicking submit manually. Never auto-submitted.');
  });

  return fillResults;
}

// Listen for Chrome runtime messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return false;

  if (request.action === 'SMARTFORM_INSPECT_DOM') {
    const data = inspectLiveForm();
    sendResponse({ status: 'success', success: true, data });
    return true;
  }

  if (request.action === 'AUTOFILL_FORM' || request.action === 'SMARTFORM_AUTO_FILL_DOM') {
    const mappings = request.mappings || request.payload?.mappings || [];
    const results = executeAutoFill(mappings);
    sendResponse({
      status: 'success',
      success: true,
      results,
      filledCount: results.filledCount,
      filledFields: results.filledFields,
      unfilledRequiredFields: results.unfilledRequiredFields,
    });
    return true;
  }

  return false;
});

// Communication bridge for SmartForm AI web app running in browser
window.addEventListener('message', (event) => {
  if (!event.data) return;

  // 1. Extension Ping / Status Check
  if (event.data.type === 'SMARTFORM_PING') {
    window.postMessage({
      type: 'SMARTFORM_PONG',
      id: event.data.id,
      version: '1.0.3',
      installed: true,
    }, '*');
    return;
  }

  // 2. Generic Extension Method Invocation (OPEN_GOVERNMENT_FORM, AUTOFILL_FORM, FOCUS_FORM_TAB, etc.)
  if (event.data.type === 'SMARTFORM_INVOKE') {
    const { id, action, payload } = event.data;

    // If AUTOFILL_FORM requested and this page itself is the live government form, execute locally too
    if (action === 'AUTOFILL_FORM' || action === 'SMARTFORM_AUTO_FILL_DOM') {
      const formEl = document.querySelector('form, #candidate_name, input[name="candidate_name"], #dob, #father_name');
      if (formEl && window.location.pathname.includes('live-test-form')) {
        const localResults = executeAutoFill(payload?.mappings || []);
        window.postMessage({
          type: 'SMARTFORM_INVOKE_RESPONSE',
          id,
          success: true,
          status: 'success',
          filledCount: localResults.filledCount,
          filledFields: localResults.filledFields,
          manualFields: localResults.unfilledRequiredFields,
          results: localResults,
        }, '*');
        return;
      }
    }

    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action, ...payload }, (bgResponse) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          window.postMessage({
            type: 'SMARTFORM_INVOKE_RESPONSE',
            id,
            success: false,
            error: lastErr.message,
          }, '*');
        } else {
          window.postMessage({
            type: 'SMARTFORM_INVOKE_RESPONSE',
            id,
            ...bgResponse,
          }, '*');
        }
      });
    } else {
      window.postMessage({
        type: 'SMARTFORM_INVOKE_RESPONSE',
        id,
        success: false,
        error: 'CHROME_RUNTIME_UNAVAILABLE',
      }, '*');
    }
    return;
  }

  // 3. Inspect request from web app
  if (event.data.type === 'SMARTFORM_INSPECT_REQUEST') {
    const data = inspectLiveForm();
    window.postMessage({ type: 'SMARTFORM_INSPECT_RESPONSE', data }, '*');
    return;
  }

  // 4. Backward compatibility: SMARTFORM_AUTO_FILL_REQUEST
  if (event.data.type === 'SMARTFORM_AUTO_FILL_REQUEST') {
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          action: 'AUTOFILL_FORM',
          sessionId: event.data.sessionId,
          targetTabId: event.data.targetTabId,
          targetWindowId: event.data.targetWindowId,
          mappings: event.data.mappings,
        },
        (bgResponse) => {
          window.postMessage({ type: 'SMARTFORM_AUTO_FILL_RESPONSE', response: bgResponse }, '*');
        }
      );
    }
  }

  // 5. Backward compatibility: SMARTFORM_FOCUS_TAB
  if (event.data.type === 'SMARTFORM_FOCUS_TAB') {
    if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'FOCUS_FORM_TAB',
        tabId: event.data.targetTabId,
        windowId: event.data.targetWindowId,
      });
    }
  }
});

// Announce extension presence to the webpage
try {
  window.__SMARTFORM_EXTENSION_INSTALLED__ = true;
  window.postMessage({ type: 'SMARTFORM_EXTENSION_READY', version: '1.0.3' }, '*');
  document.dispatchEvent(new CustomEvent('SmartFormExtensionReady', { detail: { version: '1.0.3' } }));
} catch (e) {}

