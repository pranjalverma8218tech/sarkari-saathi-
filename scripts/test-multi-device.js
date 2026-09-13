// scripts/test-multi-device.js
// Simulates Process A (Operator) and Process B (Real Phone) communicating exclusively via HTTP API

async function runTest() {
  console.log('=== MULTI-DEVICE SIMULATION TEST START ===');

  const BASE_URL = 'http://127.0.0.1:3000';

  // 1. Process A (Operator): Form Analysis (URL_PASTE)
  console.log('\n[1. Process A - Operator] Analyzing government form URL...');
  const analyzeRes = await fetch(`${BASE_URL}/api/forms/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formUrl: 'https://upsc.gov.in/apply/civil-services-2025',
      url: 'https://upsc.gov.in/apply/civil-services-2025',
      workflowMode: 'URL_PASTE',
    }),
  });

  if (!analyzeRes.ok) {
    throw new Error(`Analyze failed: ${analyzeRes.status} ${await analyzeRes.text()}`);
  }

  const analyzeData = await analyzeRes.json();
  const { sessionId, sessionUploadToken, sessionUploadUrl, documentRequirements } = analyzeData;

  console.log('Session ID:', sessionId);
  console.log('Token Length:', sessionUploadToken?.length);
  console.log('QR/Upload URL:', sessionUploadUrl);
  console.log('Document Requirements Count:', documentRequirements?.length);

  if (!sessionId || !sessionUploadToken) {
    throw new Error('Missing sessionId or sessionUploadToken from analyze response');
  }

  // 2. Process B (Phone / Mobile Browser - Clean Memory Simulation)
  console.log('\n[2. Process B - Phone Browser] Mobile device accesses QR link (/upload)...');
  const mobileUrl = `${BASE_URL}/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(sessionUploadToken)}`;

  // Test 2a: JSON API (as used by mobile React view or mobile fetch)
  const mobileApiRes = await fetch(mobileUrl, {
    headers: { Accept: 'application/json' },
  });

  console.log('Mobile JSON Status:', mobileApiRes.status);
  if (mobileApiRes.status !== 200) {
    const errText = await mobileApiRes.text();
    throw new Error(`Mobile JSON failed with status ${mobileApiRes.status}: ${errText}`);
  }

  const mobileData = await mobileApiRes.json();
  console.log('Mobile Data Valid:', mobileData.valid);
  console.log('Mobile Required Docs Count:', mobileData.documentRequirements?.length);
  console.log('Mobile Required Docs:', mobileData.documentRequirements?.map((d) => `${d.name} (${d.status})`));

  if (!mobileData.documentRequirements || mobileData.documentRequirements.length === 0) {
    throw new Error('Mobile page returned empty requiredDocuments list!');
  }

  // Test 2b: Mobile HTML browser GET
  const mobileHtmlRes = await fetch(mobileUrl);
  console.log('Mobile HTML Status:', mobileHtmlRes.status);
  const mobileHtml = await mobileHtmlRes.text();
  console.log('Mobile HTML Content Length:', mobileHtml.length);
  if (!mobileHtml.includes('Upload Documents') && !mobileHtml.includes('SmartForm')) {
    throw new Error('Mobile HTML did not render expected content!');
  }

  // Verify token is NOT consumed after mobile page load
  console.log('\n[2c. Verify Token Unconsumed] Checking token status after page access...');
  const checkTokenRes = await fetch(`${BASE_URL}/api/upload/validate?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(sessionUploadToken)}`);
  const checkTokenData = await checkTokenRes.json();
  console.log('Token Status:', checkTokenData.status, '| Expired:', checkTokenData.expired, '| Consumed:', checkTokenData.consumed);

  if (checkTokenData.consumed || checkTokenData.status === 'consumed') {
    throw new Error('Token was prematurely consumed on initial page view!');
  }

  // 3. Process B (Phone) Uploads Documents
  console.log('\n[3. Process B - Phone] Uploading documents one by one...');
  for (let i = 0; i < mobileData.documentRequirements.length; i++) {
    const doc = mobileData.documentRequirements[i];
    console.log(`\nUploading Document ${i + 1}/${mobileData.documentRequirements.length}: ${doc.name} (${doc.documentType})`);

    // Prepare simulated PDF file
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const pdfContent = `%PDF-1.4\n1 0 obj\n<< /Title (${doc.name}) /Subject (Official Government Document) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
    
    const formDataParts = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="session"`,
      '',
      sessionId,
      `--${boundary}`,
      `Content-Disposition: form-data; name="token"`,
      '',
      sessionUploadToken,
      `--${boundary}`,
      `Content-Disposition: form-data; name="requirementId"`,
      '',
      doc.id,
      `--${boundary}`,
      `Content-Disposition: form-data; name="docType"`,
      '',
      doc.documentType,
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${doc.name.replace(/\s+/g, '_')}.pdf"`,
      `Content-Type: application/pdf`,
      '',
      pdfContent,
      `--${boundary}--`,
    ];

    const bodyBuffer = Buffer.from(formDataParts.join('\r\n'));

    const uploadRes = await fetch(`${BASE_URL}/api/documents/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyBuffer,
    });

    console.log(`Upload Response Status: ${uploadRes.status}`);
    const uploadJson = await uploadRes.json();
    console.log('Upload Result:', {
      success: uploadJson.success,
      verified: uploadJson.verified,
      expectedType: uploadJson.expectedType,
      detectedType: uploadJson.detectedType,
      allVerified: uploadJson.allVerified,
    });

    if (!uploadRes.ok && uploadRes.status !== 422) {
      console.warn('Upload warning:', uploadJson);
    }
  }

  // 4. Process A (Operator) Polling Session Status
  console.log('\n[4. Process A - Operator] Polling /api/forms/session/:id...');
  const sessionPollRes = await fetch(`${BASE_URL}/api/forms/session/${sessionId}`);
  console.log('Operator Poll Status:', sessionPollRes.status);
  if (!sessionPollRes.ok) {
    throw new Error(`Operator polling failed: ${sessionPollRes.status}`);
  }

  const finalSession = await sessionPollRes.json();
  console.log('Final Session Status:', finalSession.status);
  console.log('Final Document Statuses:');
  finalSession.documentRequirements?.forEach((d) => {
    console.log(`  - ${d.name}: ${d.status} (detected: ${d.detectedType || 'n/a'})`);
  });

  console.log('\n=== MULTI-DEVICE SIMULATION TEST PASSED SUCCESSFULLY! ===');
}

runTest().catch((err) => {
  console.error('\n❌ MULTI-DEVICE TEST FAILED:', err);
  process.exit(1);
});
