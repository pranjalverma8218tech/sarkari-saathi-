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

// Execute auto-fill from SmartForm AI payload
function executeAutoFill(mappings) {
  const fillResults = {
    filledCount: 0,
    filledFields: [],
    skippedFields: [],
    manualRequiredFields: [],
    manualFileAttachments: [],
  };

  for (const mapping of mappings) {
    if (mapping.isManualEntry || !mapping.extractedValue || mapping.status === 'manual_required') {
      fillResults.manualRequiredFields.push(mapping.targetField);
      continue;
    }

    let el = null;
    if (mapping.targetSelector) {
      try {
        el = document.querySelector(mapping.targetSelector);
      } catch (e) {}
    }

    if (!el && mapping.targetId) {
      el = document.getElementById(mapping.targetId);
    }

    if (!el && mapping.targetName) {
      el = document.querySelector(`[name="${CSS.escape(mapping.targetName)}"]`);
    }

    if (!el) {
      // Try finding by label text
      const allLabels = Array.from(document.querySelectorAll('label'));
      const foundLabel = allLabels.find((l) =>
        l.innerText.toLowerCase().includes(mapping.targetField.toLowerCase())
      );
      if (foundLabel && foundLabel.htmlFor) {
        el = document.getElementById(foundLabel.htmlFor);
      }
    }

    if (el) {
      const type = (el.getAttribute('type') || '').toLowerCase();

      // Check for file input
      if (type === 'file') {
        fillResults.manualFileAttachments.push({
          field: mapping.targetField,
          documentRequired: mapping.source,
          instruction: `Manual document attachment required: Attach ${mapping.source} here.`,
        });
        // Visual indicator on the file input
        el.style.outline = '3px solid #f59e0b';
        continue;
      }

      // Radio handling
      if (type === 'radio') {
        const name = el.name;
        const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
        const valLower = mapping.extractedValue.toLowerCase();
        let radioMatched = false;
        for (const radio of radios) {
          const radioLabel = getFieldLabel(radio).toLowerCase();
          if (radio.value.toLowerCase() === valLower || radioLabel.includes(valLower)) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
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
        const shouldCheck = ['true', 'yes', '1', 'checked', 'agree'].includes(mapping.extractedValue.toLowerCase());
        el.checked = shouldCheck;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        fillResults.filledCount++;
        fillResults.filledFields.push(mapping.targetField);
        continue;
      }

      // Normal input/textarea/select
      setNativeValue(el, mapping.extractedValue);
      el.style.backgroundColor = '#ecfdf5'; // Subtle soft green feedback
      el.style.transition = 'background-color 0.5s ease';
      fillResults.filledCount++;
      fillResults.filledFields.push(mapping.targetField);
    } else {
      fillResults.skippedFields.push(mapping.targetField);
    }
  }

  // Re-scan page for required fields that remain empty!
  const remainingEmptyRequired = [];
  const allInputs = document.querySelectorAll('input, textarea, select');
  allInputs.forEach((input) => {
    const type = (input.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button'].includes(type)) return;

    const label = getFieldLabel(input);
    const isRequired = input.required || input.getAttribute('aria-required') === 'true' || label.includes('*');

    if (isRequired && !input.value.trim() && !input.checked) {
      remainingEmptyRequired.push(label.replace(/\*/g, '').trim());
      input.style.border = '2px solid #ef4444'; // Red border highlighting required empty field
    }
  });

  fillResults.unfilledRequiredFields = Array.from(new Set(remainingEmptyRequired));

  // Highlight visible submit button WITHOUT clicking it!
  const submitBtn = document.querySelector('input[type="submit"], button[type="submit"], button.submit, form button:last-of-type');
  if (submitBtn) {
    submitBtn.style.boxShadow = '0 0 0 4px #3b82f6, 0 10px 15px -3px rgba(0, 0, 0, 0.1)';
    submitBtn.setAttribute('title', 'SmartForm AI: Verify all details above before clicking submit manually.');
  }

  return fillResults;
}

// Listen for Chrome runtime messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SMARTFORM_INSPECT_DOM') {
    const data = inspectLiveForm();
    sendResponse({ status: 'success', data });
    return true;
  }

  if (request.action === 'SMARTFORM_AUTO_FILL_DOM') {
    const mappings = request.payload?.mappings || [];
    const results = executeAutoFill(mappings);
    sendResponse({ status: 'success', results });
    return true;
  }
});

// Also listen for postMessage from SmartForm AI web app if opened in the same window / tab
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SMARTFORM_INSPECT_REQUEST') {
    const data = inspectLiveForm();
    window.postMessage({ type: 'SMARTFORM_INSPECT_RESPONSE', data }, '*');
  }

  if (event.data && event.data.type === 'SMARTFORM_AUTO_FILL_REQUEST') {
    const results = executeAutoFill(event.data.mappings || []);
    window.postMessage({ type: 'SMARTFORM_AUTO_FILL_RESPONSE', results }, '*');
  }
});

// Announce extension presence to the webpage
window.__SMARTFORM_EXTENSION_INSTALLED__ = true;
window.postMessage({ type: 'SMARTFORM_EXTENSION_READY' }, '*');
