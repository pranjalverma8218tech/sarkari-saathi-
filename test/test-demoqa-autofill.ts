import puppeteer from 'puppeteer';

async function testAutofillOnDemoQA() {
  console.log('Launching browser to test autofill on DemoQA...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    console.log('Navigating to DemoQA...');
    await page.goto('https://demoqa.com/automation-practice-form', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    console.log('Waiting for #firstName selector...');
    await page.waitForSelector('#firstName', { timeout: 15000 });
    console.log('Form loaded!');

    const result = await page.evaluate(`
      (function() {
        function setNativeVal(element, value) {
          if (!element) return false;
          try { element.focus(); } catch (e) {}

          const isInput = element.tagName.toLowerCase() === 'input';
          if (isInput) {
            const proto = window.HTMLInputElement.prototype;
            const valueDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');

            const tracker = element._valueTracker;
            if (tracker) {
              tracker.setValue(String(value) === '' ? '__initial__' : '');
            }

            if (valueDescriptor && valueDescriptor.set) {
              valueDescriptor.set.call(element, value);
            } else {
              element.value = value;
            }

            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
            return element.value;
          }
          return false;
        }

        const fn = document.querySelector('#firstName');
        const ln = document.querySelector('#lastName');
        const em = document.querySelector('#userEmail');
        const num = document.querySelector('#userNumber');
        const dob = document.querySelector('#dateOfBirthInput');

        const fnVal = setNativeVal(fn, 'Rahul');
        const lnVal = setNativeVal(ln, 'Kumar');
        const emVal = setNativeVal(em, 'rahul.kumar@example.com');
        const numVal = setNativeVal(num, '9876543210');
        const dobVal = setNativeVal(dob, '14 Aug 2006');

        return {
          firstName: { value: fn ? fn.value : null, setVal: fnVal },
          lastName: { value: ln ? ln.value : null, setVal: lnVal },
          email: { value: em ? em.value : null, setVal: emVal },
          mobile: { value: num ? num.value : null, setVal: numVal },
          dob: { value: dob ? dob.value : null, setVal: dobVal },
        };
      })()
    `);

    console.log('Autofill evaluation result on DemoQA:', JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

testAutofillOnDemoQA().catch(console.error);
