import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function runDemoQAE2EValidation() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    console.log('Navigating to https://demoqa.com/automation-practice-form...');
    await page.goto('https://demoqa.com/automation-practice-form', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('Waiting for #firstName selector...');
    await page.waitForSelector('#firstName', { timeout: 15000 });

    // Read the exact content-script.js
    const contentScriptCode = fs.readFileSync(
      path.resolve(process.cwd(), 'extension/content-script.js'),
      'utf-8'
    );

    // Inject the real extension content script code into the live DemoQA page
    await page.evaluate(contentScriptCode);

    // Target fields required by prompt:
    // First Name = Pranjal
    // Last Name = Verma
    // Email = test@example.com
    // Mobile = 9876543210
    // DOB = 01 Jan 2005
    const testMappings = [
      { targetField: 'First Name', targetSelector: '#firstName', extractedValue: 'Pranjal', source: 'Aadhaar Card' },
      { targetField: 'Last Name', targetSelector: '#lastName', extractedValue: 'Verma', source: 'Aadhaar Card' },
      { targetField: 'Email', targetSelector: '#userEmail', extractedValue: 'test@example.com', source: 'User Profile' },
      { targetField: 'Mobile Number', targetSelector: '#userNumber', extractedValue: '9876543210', source: 'User Profile' },
      { targetField: 'Date of Birth', targetSelector: '#dateOfBirthInput', extractedValue: '01 Jan 2005', source: '10th Certificate' },
    ];

    // Execute autofill via the extension content script on the live DOM
    const result = await page.evaluate((mappings) => {
      // @ts-ignore
      const res = executeAutoFill(mappings);

      const fn = document.querySelector('#firstName') as HTMLInputElement | null;
      const ln = document.querySelector('#lastName') as HTMLInputElement | null;
      const em = document.querySelector('#userEmail') as HTMLInputElement | null;
      const mob = document.querySelector('#userNumber') as HTMLInputElement | null;
      const dob = document.querySelector('#dateOfBirthInput') as HTMLInputElement | null;

      return {
        filledCount: res.filledCount,
        filledFields: res.filledFields,
        elements: {
          firstName: fn ? fn.value : null,
          lastName: ln ? ln.value : null,
          email: em ? em.value : null,
          mobile: mob ? mob.value : null,
          dob: dob ? dob.value : null,
        },
        checks: {
          firstName: fn?.value === 'Pranjal',
          lastName: ln?.value === 'Verma',
          email: em?.value === 'test@example.com',
          mobile: mob?.value === '9876543210',
          dob: dob?.value === '01 Jan 2005',
        }
      };
    }, testMappings);

    console.log('Result:', JSON.stringify(result, null, 2));

    const checks = result.checks;
    const populated = [
      checks.firstName,
      checks.lastName,
      checks.email,
      checks.mobile,
      checks.dob,
    ];
    const passCount = populated.filter(Boolean).length;

    console.log(`\nDemoQA E2E: ${passCount === 5 ? 'PASS' : 'FAIL'}`);
    console.log(`Fields visibly populated: ${passCount}/5`);

    if (passCount !== 5) {
      console.log('Failing fields:', Object.entries(checks).filter(([_, v]) => !v));
    }
  } finally {
    await browser.close();
  }
}

runDemoQAE2EValidation().catch(console.error);
