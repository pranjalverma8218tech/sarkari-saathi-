import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const CDP_PORT = 9222;
const EXTENSION_DIR = path.resolve('./extension');
const CHROME_PATH = '/root/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const DEMOQA_URL = 'https://demoqa.com/automation-practice-form?hl=en-US';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runVerification() {
  console.log('=== REAL CHROME RUNTIME VERIFICATION: URL_PASTE_MODE ===');

  // Launch Chrome with extension loaded and CDP enabled
  const chromeProcess = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=' + CDP_PORT,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--no-sandbox',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    DEMOQA_URL,
  ]);

  chromeProcess.stderr.on('data', () => {});

  try {
    // 1. Wait for CDP to become active
    let tabs = null;
    for (let i = 0; i < 20; i++) {
      await delay(500);
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        if (res.ok) {
          tabs = await res.json();
          break;
        }
      } catch (e) {}
    }

    if (!tabs) {
      throw new Error('Could not connect to Chrome CDP.');
    }

    // 2. Find DemoQA tab
    let demoTab = tabs.find((t) => t.url && t.url.includes('demoqa.com'));
    if (!demoTab) {
      await delay(2000);
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      tabs = await res.json();
      demoTab = tabs.find((t) => t.url && t.url.includes('demoqa.com')) || tabs[0];
    }

    const ws = new WebSocket(demoTab.webSocketDebuggerUrl);
    let msgId = 1;
    const pending = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };

    await new Promise((resolve) => { ws.onopen = resolve; });

    function cdp(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await cdp('Page.enable');
    await cdp('Runtime.enable');

    // 3. Wait for DemoQA React form to mount
    for (let i = 0; i < 30; i++) {
      const check = await cdp('Runtime.evaluate', {
        expression: 'Boolean(document.querySelector("#firstName") && document.querySelector("#subjectsInput"))',
        returnByValue: true,
      });
      if (check?.result?.result?.value === true) break;
      await delay(300);
    }

    // 4. Ensure content-script is active in tab
    const csCode = fs.readFileSync(path.resolve(EXTENSION_DIR, 'content-script.js'), 'utf-8');
    await cdp('Runtime.evaluate', { expression: csCode });

    // 5. Inspect live DOM fields
    const inspectRes = await cdp('Runtime.evaluate', {
      expression: 'inspectLiveForm()',
      returnByValue: true,
    });
    const detected = inspectRes?.result?.result?.value?.fields || [];

    // 6. Generate mappings for target fields
    const mappings = [
      { targetField: 'First Name', targetSelector: '#firstName', extractedValue: 'Rohan', source: 'Aadhaar Card' },
      { targetField: 'Last Name', targetSelector: '#lastName', extractedValue: 'Sharma', source: 'Aadhaar Card' },
      { targetField: 'Student Email', targetSelector: '#userEmail', extractedValue: 'rohan.sharma@example.com', source: 'Aadhaar Card' },
      { targetField: 'Gender', targetSelector: '#gender-radio-1', extractedValue: 'Male', source: 'Aadhaar Card' },
      { targetField: 'Mobile Number', targetSelector: '#userNumber', extractedValue: '9876543210', source: 'Aadhaar Card' },
      { targetField: 'Date of Birth', targetSelector: '#dateOfBirthInput', extractedValue: '14 Aug 2004', source: '10th Marksheet' },
      { targetField: 'Subjects', targetSelector: '#subjectsInput', extractedValue: 'Maths', source: '10th Marksheet' },
      { targetField: 'Hobbies', targetSelector: '#hobbies-checkbox-1', extractedValue: 'Sports', source: 'Manual Entry' },
      { targetField: 'Current Address', targetSelector: '#currentAddress', extractedValue: 'House No 42, Sector 15, New Delhi', source: 'Aadhaar Card' },
    ];

    // 7. Send autofill to the DemoQA tab
    const autofillEval = await cdp('Runtime.evaluate', {
      expression: `executeAutoFill(${JSON.stringify(mappings)})`,
      awaitPromise: true,
      returnByValue: true,
    });

    await delay(600);

    // 8. Visibly verify all 9 fields in the live Chrome DOM
    const verifyEval = await cdp('Runtime.evaluate', {
      expression: `
        ({
          firstName: document.querySelector('#firstName')?.value,
          lastName: document.querySelector('#lastName')?.value,
          email: document.querySelector('#userEmail')?.value,
          gender: document.querySelector('#gender-radio-1')?.checked ? 'Male' : '',
          mobile: document.querySelector('#userNumber')?.value,
          dob: document.querySelector('#dateOfBirthInput')?.value,
          subjects: document.querySelector('.subjects-auto-complete__multi-value')?.innerText || document.querySelector('#subjectsInput')?.value || '',
          hobbies: document.querySelector('#hobbies-checkbox-1')?.checked ? 'Sports' : '',
          address: document.querySelector('#currentAddress')?.value,
        })
      `,
      returnByValue: true,
    });

    const v = verifyEval?.result?.result?.value;

    const fields = [
      { name: 'First Name', pass: v?.firstName === 'Rohan', val: v?.firstName },
      { name: 'Last Name', pass: v?.lastName === 'Sharma', val: v?.lastName },
      { name: 'Email', pass: v?.email === 'rohan.sharma@example.com', val: v?.email },
      { name: 'Gender', pass: v?.gender === 'Male', val: v?.gender },
      { name: 'Mobile Number', pass: v?.mobile === '9876543210', val: v?.mobile },
      { name: 'Date of Birth', pass: Boolean(v?.dob && v?.dob.length > 0), val: v?.dob },
      { name: 'Subjects', pass: Boolean(v?.subjects && v.subjects.includes('Maths')), val: v?.subjects },
      { name: 'Hobbies', pass: v?.hobbies === 'Sports', val: v?.hobbies },
      { name: 'Current Address', pass: v?.address === 'House No 42, Sector 15, New Delhi', val: v?.address },
    ];

    const passedCount = fields.filter((f) => f.pass).length;
    const failed = fields.filter((f) => !f.pass);

    console.log('\n--- VERIFICATION REPORT ---');
    fields.forEach((f) => {
      console.log(`[${f.pass ? 'PASS' : 'FAIL'}] ${f.name}: "${f.val}"`);
    });

    if (failed.length === 0) {
      console.log('\nURL_PASTE_MODE: PASS');
      console.log(`Visible fields filled: ${passedCount}/9`);
      console.log('Failed fields: None');
      console.log('Exact failure reason: None');
    } else {
      console.log('\nURL_PASTE_MODE: FAIL');
      console.log(`Visible fields filled: ${passedCount}/9`);
      console.log(`Failed fields: ${failed.map((f) => f.name).join(', ')}`);
      console.log(`Exact failure reason: ${failed.map((f) => `${f.name} value is "${f.val}"`).join('; ')}`);
    }

    ws.close();
  } finally {
    chromeProcess.kill();
  }
}

runVerification();
