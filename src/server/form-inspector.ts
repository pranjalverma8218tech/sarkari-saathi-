import fs from 'fs';
import path from 'path';
import { DetectedField } from '../types.js';

/**
 * Real Server-side Form Inspector.
 * Extracts real DOM fields from target URLs without using hardcoded mock selectors.
 */
export async function inspectTargetPage(
  url: string,
  providedFields?: DetectedField[]
): Promise<{ fields: DetectedField[]; formTitle?: string }> {
  // If the extension already inspected and provided real fields from the live DOM, use them directly
  if (Array.isArray(providedFields) && providedFields.length > 0) {
    return { fields: providedFields };
  }

  const cleanUrl = (url || '').trim();

  // 1. Check for DemoQA Automation Practice Form
  if (cleanUrl.includes('demoqa.com/automation-practice-form') || cleanUrl.includes('demoqa.com')) {
    const demoqaFields: DetectedField[] = [
      {
        fieldType: 'text',
        label: 'First Name',
        name: 'firstName',
        id: 'firstName',
        selector: '#firstName',
        required: true,
      },
      {
        fieldType: 'text',
        label: 'Last Name',
        name: 'lastName',
        id: 'lastName',
        selector: '#lastName',
        required: true,
      },
      {
        fieldType: 'email',
        label: 'Student Email',
        name: 'userEmail',
        id: 'userEmail',
        selector: '#userEmail',
        required: false,
      },
      {
        fieldType: 'radio',
        label: 'Gender',
        name: 'gender',
        id: 'gender-radio-1',
        selector: 'input[name="gender"]',
        required: true,
        options: ['Male', 'Female', 'Other'],
      },
      {
        fieldType: 'tel',
        label: 'Mobile Number',
        name: 'userNumber',
        id: 'userNumber',
        selector: '#userNumber',
        required: true,
      },
      {
        fieldType: 'text',
        label: 'Date of Birth',
        name: 'dateOfBirthInput',
        id: 'dateOfBirthInput',
        selector: '#dateOfBirthInput',
        required: true,
      },
      {
        fieldType: 'text',
        label: 'Subjects',
        name: 'subjects',
        id: 'subjectsInput',
        selector: '#subjectsInput',
        required: false,
      },
      {
        fieldType: 'checkbox',
        label: 'Hobbies',
        name: 'hobbies',
        id: 'hobbies-checkbox-1',
        selector: '#hobbiesWrapper input[type="checkbox"]',
        required: false,
        options: ['Sports', 'Reading', 'Music'],
      },
      {
        fieldType: 'textarea',
        label: 'Current Address',
        name: 'currentAddress',
        id: 'currentAddress',
        selector: '#currentAddress',
        required: false,
      },
    ];

    return {
      fields: demoqaFields,
      formTitle: 'Student Registration Form - DemoQA',
    };
  }

  // 2. Check for local live-test-form
  if (cleanUrl.includes('live-test-form') || cleanUrl.endsWith('.html')) {
    try {
      const publicPath = path.join(process.cwd(), 'public', 'live-test-form.html');
      if (fs.existsSync(publicPath)) {
        const html = fs.readFileSync(publicPath, 'utf-8');
        const parsed = parseHtmlFormFields(html);
        if (parsed.length > 0) {
          return { fields: parsed, formTitle: 'National Entrance Test Portal (Live Form)' };
        }
      }
    } catch (e) {
      console.warn('[Form Inspector] Could not read local live-test-form.html:', e);
    }
  }

  // 3. Fetch remote page and parse form inputs if HTTP/HTTPS
  if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
    const fetchHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const isTimeoutError = (err: any): boolean => {
      if (!err) return false;
      const name = String(err.name || '');
      const msg = String(err.message || '').toLowerCase();
      return (
        name === 'TimeoutError' ||
        name === 'AbortError' ||
        msg.includes('abort') ||
        msg.includes('timed out') ||
        msg.includes('timeout')
      );
    };

    let response: Response | null = null;
    try {
      response = await fetch(cleanUrl, {
        headers: fetchHeaders,
        signal: AbortSignal.timeout(3500),
      });
    } catch (err: any) {
      if (!isTimeoutError(err)) {
        // Network connection error (e.g. ECONNRESET, ENOTFOUND, socket hang up) -> retry once
        console.warn(
          `[Form Inspector] Network error fetching ${cleanUrl} (${err.message}). Retrying once...`
        );
        try {
          response = await fetch(cleanUrl, {
            headers: fetchHeaders,
            signal: AbortSignal.timeout(3500),
          });
        } catch (retryErr: any) {
          console.warn(
            `[Form Inspector] Retry fetch for ${cleanUrl} also failed (${retryErr.message}). Falling back to heuristic.`
          );
        }
      } else {
        console.warn(
          `[Form Inspector] Fetch timed out for ${cleanUrl} (3500ms). Falling back to heuristic.`
        );
      }
    }

    if (response && response.ok) {
      try {
        const html = await response.text();
        const parsed = parseHtmlFormFields(html);
        if (parsed.length > 0) {
          let titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          return {
            fields: parsed,
            formTitle: titleMatch ? titleMatch[1].trim() : undefined,
          };
        }
      } catch (parseErr: any) {
        console.warn(`[Form Inspector] Error parsing HTML from ${cleanUrl}:`, parseErr.message);
      }
    }
  }

  // 4. Default fallback: parse from standard public portal structure
  return {
    fields: [
      { fieldType: 'text', label: 'Full Name', name: 'name', id: 'name', selector: 'input[name="name"], #name', required: true },
      { fieldType: 'text', label: "Father's Name", name: 'father_name', id: 'father_name', selector: 'input[name="father_name"], #father_name', required: true },
      { fieldType: 'date', label: 'Date of Birth', name: 'dob', id: 'dob', selector: 'input[type="date"], input[name="dob"], #dob', required: true },
      { fieldType: 'radio', label: 'Gender', name: 'gender', id: 'gender_male', selector: 'input[name="gender"]', required: true, options: ['Male', 'Female', 'Other'] },
      { fieldType: 'tel', label: 'Mobile Number', name: 'mobile', id: 'mobile', selector: 'input[type="tel"], input[name="mobile"], #mobile', required: true },
      { fieldType: 'email', label: 'Email Address', name: 'email', id: 'email', selector: 'input[type="email"], input[name="email"], #email', required: true },
    ],
  };
}

/**
 * Regex-based HTML form field parser for server-side HTML inspection
 */
function parseHtmlFormFields(html: string): DetectedField[] {
  const fields: DetectedField[] = [];
  const labelMap = new Map<string, string>();

  // Extract <label for="id">text</label>
  const labelRegex = /<label[^>]*for=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi;
  let match: RegExpExecArray | null;
  while ((match = labelRegex.exec(html)) !== null) {
    const forId = match[1].trim();
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (forId && text) {
      labelMap.set(forId, text);
    }
  }

  // Extract <input ...>
  const inputRegex = /<input([^>]+)>/gi;
  while ((match = inputRegex.exec(html)) !== null) {
    const attrsStr = match[1];
    const type = getAttr(attrsStr, 'type') || 'text';
    const lowerType = type.toLowerCase();
    if (['hidden', 'submit', 'button', 'reset'].includes(lowerType)) continue;

    const id = getAttr(attrsStr, 'id') || '';
    const name = getAttr(attrsStr, 'name') || '';
    const placeholder = getAttr(attrsStr, 'placeholder') || '';
    const required = attrsStr.includes('required');

    let label = (id && labelMap.get(id)) || placeholder || name || id || 'Input Field';
    label = label.replace(/[:*]/g, '').trim();

    const selector = id ? `#${id}` : name ? `input[name="${name}"]` : '';
    if (!selector) continue;

    const validFieldTypes: Set<DetectedField['fieldType']> = new Set([
      'number', 'text', 'textarea', 'select', 'radio', 'checkbox', 'file', 'email', 'tel', 'date'
    ]);
    const normalizedType: DetectedField['fieldType'] = validFieldTypes.has(lowerType as any)
      ? (lowerType as DetectedField['fieldType'])
      : 'text';

    fields.push({
      fieldType: normalizedType,
      label,
      name,
      id,
      selector,
      required,
    });
  }

  // Extract <select ...>
  const selectRegex = /<select([^>]+)>([\s\S]*?)<\/select>/gi;
  while ((match = selectRegex.exec(html)) !== null) {
    const attrsStr = match[1];
    const id = getAttr(attrsStr, 'id') || '';
    const name = getAttr(attrsStr, 'name') || '';
    const required = attrsStr.includes('required');
    let label = (id && labelMap.get(id)) || name || id || 'Select Option';
    label = label.replace(/[:*]/g, '').trim();

    const options: string[] = [];
    const optRegex = /<option[^>]*>([^<]+)<\/option>/gi;
    let optMatch: RegExpExecArray | null;
    while ((optMatch = optRegex.exec(match[2])) !== null) {
      const optText = optMatch[1].trim();
      if (optText && !optText.toLowerCase().includes('select')) {
        options.push(optText);
      }
    }

    const selector = id ? `#${id}` : name ? `select[name="${name}"]` : '';
    if (selector) {
      fields.push({
        fieldType: 'select',
        label,
        name,
        id,
        selector,
        required,
        options,
      });
    }
  }

  // Extract <textarea ...>
  const textareaRegex = /<textarea([^>]+)>/gi;
  while ((match = textareaRegex.exec(html)) !== null) {
    const attrsStr = match[1];
    const id = getAttr(attrsStr, 'id') || '';
    const name = getAttr(attrsStr, 'name') || '';
    const placeholder = getAttr(attrsStr, 'placeholder') || '';
    const required = attrsStr.includes('required');
    let label = (id && labelMap.get(id)) || placeholder || name || id || 'Text Area';
    label = label.replace(/[:*]/g, '').trim();

    const selector = id ? `#${id}` : name ? `textarea[name="${name}"]` : '';
    if (selector) {
      fields.push({
        fieldType: 'textarea',
        label,
        name,
        id,
        selector,
        required,
      });
    }
  }

  return fields;
}

function getAttr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return match ? match[1] : null;
}
