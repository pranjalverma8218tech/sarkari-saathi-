/**
 * SmartForm AI Chrome Extension - Content Script
 * Executes in the context of the live webpage.
 * Deep DOM inspector and live auto-fill engine.
 */

// Helper to determine element label
function getFieldLabel(el) {
  const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();

  // 1. Differentiate First Name / Last Name or specific placeholders for text inputs
  if (el.placeholder && el.placeholder.trim() && !['radio', 'checkbox'].includes(type)) {
    const ph = el.placeholder.trim();
    const phLower = ph.toLowerCase();
    if (
      phLower.includes('first') ||
      phLower.includes('last') ||
      phLower.includes('middle') ||
      phLower.includes('mobile') ||
      phLower.includes('email') ||
      phLower.includes('address')
    ) {
      return ph;
    }
  }

  // 2. Radio & Checkbox group context (e.g. Gender, Hobbies, Status)
  if (['radio', 'checkbox'].includes(type)) {
    const rowOrGroup = el.closest(
      '.row, [id$="-wrapper"], [id$="Wrapper"], .form-group, .form-row, fieldset, [class*="group"]'
    );
    if (rowOrGroup) {
      let gText = '';
      const firstCol = rowOrGroup.querySelector('div[class*="col"]:first-child, [class*="title"], [class*="header"]');
      if (firstCol && !firstCol.querySelector('input, select, textarea') && firstCol.innerText.trim().length > 0 && firstCol.innerText.trim().length < 50) {
        gText = firstCol.innerText.trim();
      } else {
        const groupLabel = rowOrGroup.querySelector(
          'label[id$="-label"]:not([class*="form-check"]), label:not([for]):not([class*="form-check"]), legend, .col-form-label'
        );
        if (groupLabel && groupLabel.innerText && groupLabel.innerText.trim()) {
          gText = groupLabel.innerText.trim();
        }
      }

      let optText = '';
      if (el.id) {
        const optLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (optLabel && optLabel.innerText.trim()) optText = optLabel.innerText.trim();
      }
      if (!optText) {
        const pLabel = el.closest('label');
        if (pLabel && pLabel.innerText.trim()) optText = pLabel.innerText.trim();
      }

      if (gText && optText) return `${gText} (${optText})`;
      if (gText) return gText;
      if (optText) return optText;
    }
  }

  // 3. Explicit <label for="id">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label && label.innerText.trim()) return label.innerText.trim();
  }

  // 4. Enclosing <label>
  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel.innerText.trim()) {
    return parentLabel.innerText.replace(el.value || '', '').trim();
  }

  // 5. Row / Group Wrapper context (Bootstrap .row, DemoQA #...-wrapper, .form-group)
  const rowOrGroup = el.closest(
    '.row, [id$="-wrapper"], [id$="Wrapper"], .form-group, .form-row, fieldset, [class*="group"]'
  );
  if (rowOrGroup) {
    const groupLabel = rowOrGroup.querySelector('label[id$="-label"], label:not([for]), .form-label, .col-form-label, legend, [class*="label"]');
    if (groupLabel && groupLabel.innerText && groupLabel.innerText.trim()) {
      return groupLabel.innerText.trim();
    }
    const firstCol = rowOrGroup.querySelector('div[class*="col"]:first-child');
    if (firstCol && firstCol.innerText && firstCol.innerText.trim().length > 0 && firstCol.innerText.trim().length < 50) {
      return firstCol.innerText.trim();
    }
  }

  // 4. aria-label or aria-labelledby
  if (el.getAttribute('aria-label')) {
    return el.getAttribute('aria-label').trim();
  }
  if (el.getAttribute('aria-labelledby')) {
    const ref = document.getElementById(el.getAttribute('aria-labelledby'));
    if (ref && ref.innerText.trim()) return ref.innerText.trim();
  }

  // 5. Placeholder
  if (el.placeholder && el.placeholder.trim()) {
    return el.placeholder.trim();
  }

  // 6. Table context (e.g. <tr><td>Label</td><td><input></td></tr>)
  const td = el.closest('td');
  if (td && td.previousElementSibling && td.previousElementSibling.innerText.trim()) {
    return td.previousElementSibling.innerText.trim();
  }

  // 7. Fieldset legend or preceding sibling text
  const fieldset = el.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend && legend.innerText.trim()) {
      return legend.innerText.trim();
    }
  }

  // 8. Nearby text
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.innerText && prev.innerText.trim().length > 0 && prev.innerText.trim().length < 60) {
      return prev.innerText.trim();
    }
    prev = prev.previousElementSibling;
  }

  // 9. Fallback to name or id
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
function setNativeValue(element, value, shouldBlur = true) {
  if (!element) return false;
  const tagName = element.tagName.toLowerCase();
  const isInput = tagName === 'input';
  const isTextarea = tagName === 'textarea';
  const isSelect = tagName === 'select';

  try {
    element.focus();
  } catch (e) {}

  if (isInput || isTextarea) {
    const proto = isInput ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const valueDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    // Handle React internal tracker (React 15/16/17/18/19 _valueTracker)
    const tracker = element._valueTracker;
    if (tracker) {
      tracker.setValue(String(value) === '' ? '__initial__' : '');
    }

    if (valueDescriptor && valueDescriptor.set) {
      valueDescriptor.set.call(element, value);
    } else {
      element.value = value;
    }

    // Trigger full synthetic event sequence for frameworks (React, Angular, Vue, Alpine, Svelte)
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    if (shouldBlur) {
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    }

    // Verify the resulting value
    let verified = element.value === String(value);
    if (!verified) {
      try {
        element.value = value;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: String(value) }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        if (shouldBlur) {
          element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        }
        verified = element.value === String(value);
      } catch (e) {}
    }
    return verified;
  } else if (isSelect) {
    // Match option by value or text
    let matched = false;
    const valLower = ('' + value).toLowerCase().trim();
    for (let i = 0; i < element.options.length; i++) {
      const opt = element.options[i];
      const optVal = (opt.value || '').toLowerCase().trim();
      const optText = (opt.text || '').toLowerCase().trim();
      if (optVal === valLower || optText === valLower || optText.includes(valLower) || valLower.includes(optText)) {
        element.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched && element.options.length > 0) {
      const proto = window.HTMLSelectElement.prototype;
      const valueDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (valueDescriptor && valueDescriptor.set) {
        valueDescriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    }
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    return element.selectedIndex >= 0 || Boolean(element.value);
  }
  return false;
}

// Helper to fill split date fields (Day, Month, Year separate inputs/selects)
function fillSplitDateFields(allInputs, rawDateStr) {
  if (!rawDateStr || typeof rawDateStr !== 'string') return false;
  const clean = rawDateStr.trim();
  let day = '', month = '', year = '';

  const dmyMatch = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    day = dmyMatch[1];
    month = dmyMatch[2];
    year = dmyMatch[3];
  } else {
    const ymdMatch = clean.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (ymdMatch) {
      year = ymdMatch[1];
      month = ymdMatch[2];
      day = ymdMatch[3];
    }
  }

  if (!day || !month || !year) return false;

  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthIdx = parseInt(month, 10) - 1;
  const monthName = monthNames[monthIdx] || '';

  let filledAny = false;
  allInputs.forEach((el) => {
    const label = getFieldLabel(el).toLowerCase();
    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const isDay = label.includes('day') || name.includes('day') || id.includes('day') || name.includes('dob_dd');
    const isMonth = label.includes('month') || name.includes('month') || id.includes('month') || name.includes('dob_mm');
    const isYear = label.includes('year') || name.includes('year') || id.includes('year') || name.includes('dob_yyyy') || name.includes('dob_yy');

    if (isDay && !el.value) {
      setNativeValue(el, day);
      filledAny = true;
    } else if (isMonth && !el.value) {
      if (el.tagName.toLowerCase() === 'select') {
        // Try month number, padded number, and month name
        setNativeValue(el, monthName || month);
      } else {
        setNativeValue(el, month);
      }
      filledAny = true;
    } else if (isYear && !el.value) {
      setNativeValue(el, year);
      filledAny = true;
    }
  });

  return filledAny;
}

// Helper to normalize and format dates for different input types
function normalizeDateValue(value, inputType, targetElement) {
  if (!value || typeof value !== 'string') return value;
  const clean = value.trim();

  let day = '', month = '', year = '';
  // Match DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmyMatch) {
    day = dmyMatch[1].padStart(2, '0');
    month = dmyMatch[2].padStart(2, '0');
    year = dmyMatch[3];
  } else {
    // Match YYYY-MM-DD
    const ymdMatch = clean.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (ymdMatch) {
      year = ymdMatch[1];
      month = ymdMatch[2].padStart(2, '0');
      day = ymdMatch[3].padStart(2, '0');
    }
  }

  if (day && month && year) {
    if (inputType === 'date') {
      return `${year}-${month}-${day}`; // ISO format for <input type="date">
    }
    // Check if target is a React DatePicker or DemoQA dateOfBirthInput expecting "DD MMM YYYY"
    const isDatePicker = targetElement && (
      targetElement.id === 'dateOfBirthInput' ||
      targetElement.closest('.react-datepicker__input-container') ||
      targetElement.getAttribute('dateFormat') ||
      (targetElement.className && targetElement.className.includes('datepicker'))
    );
    if (isDatePicker) {
      const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mIdx = parseInt(month, 10) - 1;
      const mName = monthShortNames[mIdx] || month;
      return `${day} ${mName} ${year}`;
    }
    return `${day}/${month}/${year}`;
  }

  return clean;
}

// Robust React-Select compatible autofill for multi-value fields
async function fillReactSelectMultiValue(inputEl, valStr) {
  if (!inputEl) return false;
  const subjects = String(valStr).split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (subjects.length === 0) subjects.push(String(valStr).trim());

  let anyCommitted = false;

  for (const subj of subjects) {
    if (!subj) continue;

    // 1. Focus #subjectsInput
    try {
      inputEl.focus();
    } catch (e) {}

    // 2. Set the native input value using the existing framework-safe setter without blurring
    setNativeValue(inputEl, subj, false);

    // Small delay for React-Select to process input and display options
    await new Promise((r) => setTimeout(r, 80));

    // 3. Trigger the React-Select option selection/commit using realistic keyboard events (keydown/keyup), especially Enter
    const keyOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true, cancelable: true };
    inputEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

    // 4. Wait for the selected-value/chip to appear in the DOM
    let chipAppeared = false;
    for (let i = 0; i < 20; i++) {
      const chip = document.querySelector('.subjects-auto-complete__multi-value, [class*="multi-value"]');
      if (chip) {
        chipAppeared = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    // 5. Only then blur/tab away
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, composed: true }));
    try {
      inputEl.blur();
    } catch (e) {}
    inputEl.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

    // 6. Verify that the selected subject/chip remains present after blur
    await new Promise((r) => setTimeout(r, 50));
    const chipAfter = document.querySelector('.subjects-auto-complete__multi-value, [class*="multi-value"]');
    if (chipAfter || chipAppeared) {
      anyCommitted = true;
    }
  }

  // Visual feedback
  const wrapper = inputEl.closest('#subjectsWrapper, #subjectsContainer, [class*="container"]') || inputEl.parentElement;
  if (wrapper) {
    wrapper.style.backgroundColor = '#ecfdf5';
    wrapper.style.borderColor = '#10b981';
  }

  return anyCommitted;
}

// Execute auto-fill from SmartForm AI payload
async function executeAutoFill(mappings) {
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

    const valStr = String(mapping.extractedValue).trim();
    const valLower = valStr.toLowerCase();
    const targetLabelLower = (mapping.targetField || '').toLowerCase().trim();

    let el = null;

    // 1. Target Selector match
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

    // Special handler: Candidate Name / Full Name when page has split first and last name fields
    const isFullNameField =
      (targetLabelLower.includes('name') && !targetLabelLower.includes('father') && !targetLabelLower.includes('mother') && !targetLabelLower.includes('board')) &&
      !targetLabelLower.includes('first') &&
      !targetLabelLower.includes('last');
    if (isFullNameField) {
      const fnEl = document.querySelector('#firstName, input[name="firstName"], input[name="first_name"]');
      const lnEl = document.querySelector('#lastName, input[name="lastName"], input[name="last_name"]');
      if (fnEl && lnEl && (!el || el.id === 'firstName' || el.id === 'lastName')) {
        const parts = valStr.split(/\s+/);
        if (parts.length >= 2) {
          setNativeValue(fnEl, parts[0]);
          setNativeValue(lnEl, parts.slice(1).join(' '));
          fillResults.filledCount += 2;
          fillResults.filledFields.push('First Name', 'Last Name');
          continue;
        }
      }
    }

    // Special handler: First Name or Last Name specifically
    if (targetLabelLower.includes('first') && targetLabelLower.includes('name')) {
      const fnEl = document.querySelector('#firstName, input[name="firstName"], input[name="first_name"]');
      if (fnEl) el = fnEl;
    } else if (targetLabelLower.includes('last') && targetLabelLower.includes('name')) {
      const lnEl = document.querySelector('#lastName, input[name="lastName"], input[name="last_name"]');
      if (lnEl) el = lnEl;
    }

    // Special handler: Date of Birth (#dateOfBirthInput)
    if (targetLabelLower.includes('birth') || targetLabelLower.includes('dob')) {
      const dobEl = document.querySelector('#dateOfBirthInput, input[name="dateOfBirthInput"], input[name="dob"]');
      if (dobEl) el = dobEl;
    }

    // Special handler: Subjects (#subjectsInput inside React-Select)
    if (targetLabelLower.includes('subject')) {
      const subEl = document.querySelector('#subjectsInput, #subjectsContainer input, input[name="subjects"]');
      if (subEl) el = subEl;
    }

    // Special handler: Mobile (#userNumber)
    if (targetLabelLower.includes('mobile') || targetLabelLower.includes('phone') || targetLabelLower.includes('contact')) {
      const mobEl = document.querySelector('#userNumber, input[name="userNumber"], input[type="tel"]');
      if (mobEl) el = mobEl;
    }

    // Special handler: Email (#userEmail)
    if (targetLabelLower.includes('email')) {
      const emEl = document.querySelector('#userEmail, input[name="userEmail"], input[type="email"]');
      if (emEl) el = emEl;
    }

    // Special handler: Address (#currentAddress)
    if (targetLabelLower.includes('address')) {
      const addrEl = document.querySelector('#currentAddress, textarea[name="currentAddress"], textarea[id*="address"]');
      if (addrEl) el = addrEl;
    }

    // Special handler: Gender (Radio Group)
    if (targetLabelLower.includes('gender')) {
      const genderRadios = Array.from(document.querySelectorAll('input[type="radio"][name="gender"], #genterWrapper input[type="radio"], [id*="gender"] input[type="radio"]'));
      if (genderRadios.length > 0) {
        let matchedRadio = null;
        for (const gr of genderRadios) {
          const rVal = (gr.value || '').toLowerCase();
          const rLabel = (getFieldLabel(gr) || '').toLowerCase();
          const optLabel = gr.id ? (document.querySelector(`label[for="${CSS.escape(gr.id)}"]`)?.innerText || '').toLowerCase() : '';
          if (
            rVal === valLower ||
            optLabel === valLower ||
            (valLower.startsWith('m') && (rVal.startsWith('m') || optLabel.startsWith('m'))) ||
            (valLower.startsWith('f') && (rVal.startsWith('f') || optLabel.startsWith('f'))) ||
            (valLower.startsWith('o') && (rVal.startsWith('o') || optLabel.startsWith('o')))
          ) {
            matchedRadio = gr;
            break;
          }
        }
        if (!matchedRadio) matchedRadio = genderRadios[0];

        if (matchedRadio) {
          const proto = window.HTMLInputElement.prototype;
          const checkedDesc = Object.getOwnPropertyDescriptor(proto, 'checked');
          if (matchedRadio._valueTracker) matchedRadio._valueTracker.setValue(!matchedRadio.checked);
          if (checkedDesc && checkedDesc.set) checkedDesc.set.call(matchedRadio, true);
          else matchedRadio.checked = true;

          const labelFor = matchedRadio.id ? document.querySelector(`label[for="${CSS.escape(matchedRadio.id)}"]`) : null;
          const parentLabel = matchedRadio.closest('label');
          const clickEl = labelFor || parentLabel || matchedRadio;

          try { matchedRadio.focus(); } catch (e) {}
          try { clickEl.click(); } catch (e) {}

          matchedRadio.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          matchedRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          matchedRadio.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

          fillResults.filledCount++;
          fillResults.filledFields.push(mapping.targetField);
          continue;
        }
      }
    }

    // Special handler: Hobbies (Checkboxes)
    if (targetLabelLower.includes('hobbi') || targetLabelLower.includes('hobby')) {
      const hobbyCheckboxes = Array.from(document.querySelectorAll('#hobbiesWrapper input[type="checkbox"], input[type="checkbox"][id*="hobbies"]'));
      if (hobbyCheckboxes.length > 0) {
        let hobbyFilled = false;
        for (const cb of hobbyCheckboxes) {
          const optLabel = cb.id ? (document.querySelector(`label[for="${CSS.escape(cb.id)}"]`)?.innerText || '').toLowerCase().trim() : '';
          const cbVal = (cb.value || '').toLowerCase().trim();
          const shouldCheck =
            valLower.includes('all') ||
            (optLabel && valLower.includes(optLabel)) ||
            (cbVal && valLower.includes(cbVal)) ||
            (valLower.includes('sport') && optLabel.includes('sport')) ||
            (valLower.includes('read') && optLabel.includes('read')) ||
            (valLower.includes('music') && optLabel.includes('music'));

          if (shouldCheck) {
            if (!cb.checked) {
              const labelFor = cb.id ? document.querySelector(`label[for="${CSS.escape(cb.id)}"]`) : null;
              const parentLabel = cb.closest('label');
              const clickEl = labelFor || parentLabel || cb;

              try { cb.focus(); } catch (e) {}
              try { clickEl.click(); } catch (e) {}

              if (!cb.checked) {
                const proto = window.HTMLInputElement.prototype;
                const checkedDesc = Object.getOwnPropertyDescriptor(proto, 'checked');
                if (cb._valueTracker) cb._valueTracker.setValue(false);
                if (checkedDesc && checkedDesc.set) checkedDesc.set.call(cb, true);
                else cb.checked = true;

                cb.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                cb.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              }
            }

            try { cb.dispatchEvent(new Event('blur', { bubbles: true, composed: true })); } catch (e) {}
            hobbyFilled = true;
          }
        }
        if (hobbyFilled) {
          fillResults.filledCount++;
          fillResults.filledFields.push(mapping.targetField);
          continue;
        }
      }
    }

    // 4. Semantic fallback search all form inputs
    if (!el) {
      el = allInputs.find((candidate) => {
        const type = (candidate.getAttribute('type') || '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset'].includes(type)) return false;

        const label = getFieldLabel(candidate).toLowerCase();
        const placeholder = (candidate.placeholder || '').toLowerCase();
        const name = (candidate.name || '').toLowerCase();
        const id = (candidate.id || '').toLowerCase();

        return (
          label === targetLabelLower ||
          name === targetLabelLower ||
          id === targetLabelLower ||
          label.includes(targetLabelLower) ||
          targetLabelLower.includes(label) ||
          (placeholder && placeholder.includes(targetLabelLower))
        );
      });
    }

    if (el) {
      const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();

      // Check for file input
      if (type === 'file') {
        fillResults.manualFileAttachments.push({
          field: mapping.targetField,
          documentRequired: mapping.source,
          instruction: `Manual document attachment required: Attach ${mapping.source} here.`,
        });
        el.style.outline = '3px solid #f59e0b';
        el.style.backgroundColor = '#fffbeb';
        continue;
      }

      // Check for React-Select subjects input
      if (el.id === 'subjectsInput' || el.closest('#subjectsContainer') || targetLabelLower.includes('subject')) {
        await fillReactSelectMultiValue(el, valStr);
        fillResults.filledCount++;
        fillResults.filledFields.push(mapping.targetField);
        continue;
      }

      // Check for date input (react-datepicker or HTML date)
      if (el.id === 'dateOfBirthInput' || type === 'date' || el.closest('.react-datepicker__input-container')) {
        const normalizedDate = normalizeDateValue(valStr, type, el);
        setNativeValue(el, normalizedDate);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
        fillResults.filledCount++;
        fillResults.filledFields.push(mapping.targetField);
        continue;
      }

      // Radio button handling
      if (type === 'radio') {
        const name = el.name;
        const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
        let radioMatched = false;
        for (const radio of radios) {
          const radioLabel = getFieldLabel(radio).toLowerCase().trim();
          const radioVal = (radio.value || '').toLowerCase().trim();
          const optLabel = radio.id ? (document.querySelector(`label[for="${CSS.escape(radio.id)}"]`)?.innerText || '').toLowerCase() : '';
          if (
            radioVal === valLower ||
            optLabel === valLower ||
            radioLabel === valLower ||
            radioLabel.includes(valLower) ||
            valLower.includes(radioVal)
          ) {
            const proto = window.HTMLInputElement.prototype;
            const checkedDesc = Object.getOwnPropertyDescriptor(proto, 'checked');
            if (radio._valueTracker) radio._valueTracker.setValue(!radio.checked);
            if (checkedDesc && checkedDesc.set) checkedDesc.set.call(radio, true);
            else radio.checked = true;

            const labelFor = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
            const parentLabel = radio.closest('label');
            const clickEl = labelFor || parentLabel || radio;
            try { radio.focus(); } catch (e) {}
            try { clickEl.click(); } catch (e) {}

            radio.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            radio.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            radio.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
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
        const elLabel = (getFieldLabel(el) || '').toLowerCase();
        const optLabel = el.id ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText || '').toLowerCase() : '';
        const shouldCheck =
          ['true', 'yes', '1', 'checked', 'agree', 'y'].includes(valLower) ||
          (optLabel && valLower.includes(optLabel)) ||
          valLower.includes((el.value || '').toLowerCase());

        if (el.checked !== shouldCheck) {
          const labelFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
          const parentLabel = el.closest('label');
          const clickEl = labelFor || parentLabel || el;
          try { el.focus(); } catch (e) {}
          try { clickEl.click(); } catch (e) {}

          if (el.checked !== shouldCheck) {
            const proto = window.HTMLInputElement.prototype;
            const checkedDesc = Object.getOwnPropertyDescriptor(proto, 'checked');
            if (el._valueTracker) el._valueTracker.setValue(!shouldCheck);
            if (checkedDesc && checkedDesc.set) checkedDesc.set.call(el, shouldCheck);
            else el.checked = shouldCheck;

            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          }
        }

        try { el.dispatchEvent(new Event('blur', { bubbles: true, composed: true })); } catch (e) {}
        fillResults.filledCount++;
        fillResults.filledFields.push(mapping.targetField);
        continue;
      }

      // Standard text / email / tel / textarea / select handling
      const normalizedValue = normalizeDateValue(valStr, type, el);
      setNativeValue(el, normalizedValue);

      // Visual feedback: soft green background
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
      // Check if this mapping is a Date of Birth and the form has split DOB fields
      const isDob = targetLabelLower.includes('birth') || targetLabelLower.includes('dob');
      if (isDob && valStr) {
        const splitFilled = fillSplitDateFields(allInputs, valStr);
        if (splitFilled) {
          fillResults.filledCount++;
          fillResults.filledFields.push(mapping.targetField + ' (Split Date)');
          continue;
        }
      }

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
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return false;

    if (request.action === 'SMARTFORM_INSPECT_DOM') {
      const data = inspectLiveForm();
      sendResponse({ status: 'success', success: true, data });
      return true;
    }

    if (request.action === 'AUTOFILL_FORM' || request.action === 'SMARTFORM_AUTO_FILL_DOM') {
      const mappings = request.mappings || request.payload?.mappings || [];
      executeAutoFill(mappings)
        .then((finalRes) => {
          sendResponse({
            status: 'success',
            success: true,
            results: finalRes,
            filledCount: finalRes.filledCount,
            filledFields: finalRes.filledFields,
            unfilledRequiredFields: finalRes.unfilledRequiredFields,
          });
        })
        .catch((err) => {
          sendResponse({
            status: 'error',
            success: false,
            error: err.message,
          });
        });
      return true;
    }

    return false;
  });
}

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
        executeAutoFill(payload?.mappings || []).then((localResults) => {
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
        });
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

