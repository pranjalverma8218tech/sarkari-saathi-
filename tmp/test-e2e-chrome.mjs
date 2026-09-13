import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/root/.cache/puppeteer/chrome/linux-152.0.7977.75/chrome-linux64/chrome';
const EXTENSION_DIR = path.resolve(process.cwd(), 'extension');
const DEMOQA_URL = 'https://demoqa.com/automation-practice-form?hl=en-US';

console.log('--- Starting Real Chrome Runtime E2E Test ---');
console.log('Chrome Binary:', CHROME_PATH);
console.log('Extension Dir:', EXTENSION_DIR);

const USER_DATA_DIR = `/tmp/chrome-test-profile-${Date.now()}`;
fs.mkdirSync(USER_DATA_DIR, { recursive: true });

const chromeArgs = [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  `--user-data-dir=${USER_DATA_DIR}`,
  `--disable-extensions-except=${EXTENSION_DIR}`,
  `--load-extension=${EXTENSION_DIR}`,
  DEMOQA_URL,
];

console.log('Launching Chrome...');
const chromeProcess = spawn(CHROME_PATH, chromeArgs, {
  stdio: ['ignore', 'pipe', 'pipe'],
});

chromeProcess.stderr.on('data', (d) => {
  // console.log('[Chrome]', d.toString());
});

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForCdp(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      const tabs = await res.json();
      if (tabs && tabs.length > 0) return tabs;
    } catch (e) {}
    await delay(500);
  }
  throw new Error('Could not connect to Chrome CDP on port 9222');
}

async function runTest() {
  try {
    console.log('Waiting for Chrome DevTools Protocol to be available...');
    const tabs = await waitForCdp();
    console.log(`Discovered ${tabs.length} Chrome tabs/targets`);

    // Find the DemoQA tab
    let demoTab = tabs.find((t) => t.url.includes('demoqa.com'));
    if (!demoTab) {
      console.log('DemoQA tab not yet loaded in /json/list, waiting...');
      await delay(3000);
      const updatedTabs = await waitForCdp();
      demoTab = updatedTabs.find((t) => t.url.includes('demoqa.com')) || updatedTabs[0];
    }
    console.log('Target Tab found:', demoTab.title, demoTab.url);

    // Connect WebSocket
    const ws = new WebSocket(demoTab.webSocketDebuggerUrl);

    let msgId = 1;
    const pendingCalls = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pendingCalls.has(msg.id)) {
        pendingCalls.get(msg.id)(msg);
        pendingCalls.delete(msg.id);
      }
    };

    await new Promise((resolve) => {
      ws.onopen = resolve;
    });

    function sendCommand(method, params = {}) {
      return new Promise((resolve) => {
        const id = msgId++;
        pendingCalls.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    console.log('Enabling Page and Runtime domains...');
    await sendCommand('Page.enable');
    await sendCommand('Runtime.enable');

    // Wait for React to render on DemoQA
    console.log('Waiting for DemoQA form elements to mount...');
    let formMounted = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      const evalRes = await sendCommand('Runtime.evaluate', {
        expression: 'Boolean(document.querySelector("#userForm") && document.querySelector("#firstName"))',
        returnByValue: true,
      });
      if (evalRes?.result?.result?.value === true) {
        formMounted = true;
        console.log(`DemoQA React form mounted after ${attempt * 500}ms`);
        break;
      }
      await delay(500);
    }

    if (!formMounted) {
      throw new Error('DemoQA form failed to mount in Chrome');
    }

    // 1. Test EXTENSION_INSPECTION_MODE: inspectLiveForm()
    console.log('\n--- Test 1: Testing EXTENSION_INSPECTION_MODE (DOM Inspection) ---');
    const inspectRes = await sendCommand('Runtime.evaluate', {
      expression: `
        (function() {
          if (typeof inspectLiveForm !== 'function') {
            // Inject inspectLiveForm function from content-script if needed
            return { error: 'inspectLiveForm not in scope yet' };
          }
          return inspectLiveForm();
        })()
      `,
      returnByValue: true,
    });

    console.log('Content script inspectLiveForm result status:', inspectRes?.result?.result?.value?.error ? 'Injecting directly' : 'Active');

    // If content script was injected into isolated world, let's test running content-script functions via evaluate
    // or test executeAutoFill directly
    const csCode = fs.readFileSync(path.resolve(EXTENSION_DIR, 'content-script.js'), 'utf-8');
    
    // Inject content-script into page context to run inspection test
    await sendCommand('Runtime.evaluate', {
      expression: csCode,
    });

    const liveInspection = await sendCommand('Runtime.evaluate', {
      expression: 'inspectLiveForm()',
      returnByValue: true,
    });

    const detected = liveInspection?.result?.result?.value;
    console.log(`Detected fields count: ${detected?.fields?.length}`);
    console.log('Detected field labels:');
    detected?.fields?.forEach((f) => {
      console.log(`  - [${f.fieldType}] "${f.label}" (id: ${f.id}, name: ${f.name})`);
    });

    // Verify key fields exist in inspection
    const requiredFieldKeywords = ['first name', 'last name', 'email', 'gender', 'mobile', 'date of birth', 'subjects', 'hobbies', 'address'];
    const detectedLabels = (detected?.fields || []).map((f) => f.label.toLowerCase());
    
    console.log('\nChecking field detection:');
    for (const req of requiredFieldKeywords) {
      const found = detectedLabels.some((l) => l.includes(req));
      console.log(`  ${found ? 'PASS' : 'FAIL'}: "${req}" detected in live DOM`);
    }

    // 2. Test executeAutoFill with test payload
    console.log('\n--- Test 2: Testing executeAutoFill (DOM Injection & Framework Compatibility) ---');
    const testMappings = [
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

    const autofillRes = await sendCommand('Runtime.evaluate', {
      expression: `executeAutoFill(${JSON.stringify(testMappings)})`,
      awaitPromise: true,
      returnByValue: true,
    });

    console.log('executeAutoFill result:', JSON.stringify(autofillRes?.result?.result?.value, null, 2));

    await delay(1000);

    // 3. Visible Verification: Check DOM elements in real Chrome
    console.log('\n--- Test 3: Visible Verification in Real Chrome DOM ---');
    const domCheck = await sendCommand('Runtime.evaluate', {
      expression: `
        ({
          firstName: document.querySelector('#firstName')?.value,
          lastName: document.querySelector('#lastName')?.value,
          userEmail: document.querySelector('#userEmail')?.value,
          genderMaleChecked: document.querySelector('#gender-radio-1')?.checked,
          genderFemaleChecked: document.querySelector('#gender-radio-2')?.checked,
          userNumber: document.querySelector('#userNumber')?.value,
          dateOfBirthInput: document.querySelector('#dateOfBirthInput')?.value,
          currentAddress: document.querySelector('#currentAddress')?.value,
          hobbiesSportsChecked: document.querySelector('#hobbies-checkbox-1')?.checked,
          subjectsVal: document.querySelector('#subjectsInput')?.value || document.querySelector('.subjects-auto-complete__multi-value')?.innerText || '',
        })
      `,
      returnByValue: true,
    });

    console.log('Real Chrome DOM Values:');
    console.log(JSON.stringify(domCheck?.result?.result?.value, null, 2));

    const vals = domCheck?.result?.result?.value;
    const verifications = [
      { name: 'First Name', passed: vals?.firstName === 'Rohan', actual: vals?.firstName },
      { name: 'Last Name', passed: vals?.lastName === 'Sharma', actual: vals?.lastName },
      { name: 'Email', passed: vals?.userEmail === 'rohan.sharma@example.com', actual: vals?.userEmail },
      { name: 'Gender (Male radio checked)', passed: vals?.genderMaleChecked === true, actual: vals?.genderMaleChecked },
      { name: 'Mobile Number', passed: vals?.userNumber === '9876543210', actual: vals?.userNumber },
      { name: 'Date of Birth', passed: Boolean(vals?.dateOfBirthInput && vals?.dateOfBirthInput.length > 0), actual: vals?.dateOfBirthInput },
      { name: 'Subjects (React-Select multi-value chip)', passed: Boolean(vals?.subjectsVal && vals.subjectsVal.includes('Maths')), actual: vals?.subjectsVal },
      { name: 'Hobbies (Sports checked)', passed: vals?.hobbiesSportsChecked === true, actual: vals?.hobbiesSportsChecked },
      { name: 'Current Address', passed: vals?.currentAddress === 'House No 42, Sector 15, New Delhi', actual: vals?.currentAddress },
    ];

    console.log('\nFinal E2E Verification Results:');
    let allPassed = true;
    for (const v of verifications) {
      console.log(`  [${v.passed ? 'PASS' : 'FAIL'}] ${v.name}: "${v.actual}"`);
      if (!v.passed) allPassed = false;
    }

    if (allPassed) {
      console.log('\n>>> ALL REAL CHROME E2E VERIFICATIONS PASSED SUCCESSFULLY! <<<');
    } else {
      console.log('\n>>> SOME VERIFICATIONS FAILED <<<');
    }

    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
    try {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

runTest().catch((err) => {
  console.error('Test Error:', err);
  chromeProcess.kill('SIGTERM');
  process.exit(1);
});
