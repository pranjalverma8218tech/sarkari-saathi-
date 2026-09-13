import puppeteer from 'puppeteer';

async function testDemoQA() {
  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    console.log('Navigating to DemoQA Practice Form...');
    await page.goto('https://demoqa.com/automation-practice-form', {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });
    console.log('Title:', await page.title());
    const firstName = await page.$('#firstName');
    const lastName = await page.$('#lastName');
    const userEmail = await page.$('#userEmail');
    const userNumber = await page.$('#userNumber');
    const dateOfBirth = await page.$('#dateOfBirthInput');

    console.log('Fields found:', {
      firstName: !!firstName,
      lastName: !!lastName,
      userEmail: !!userEmail,
      userNumber: !!userNumber,
      dateOfBirth: !!dateOfBirth,
    });
  } finally {
    await browser.close();
  }
}

testDemoQA().catch(console.error);
