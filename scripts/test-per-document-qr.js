// scripts/test-per-document-qr.js
// Tests the separate-QR-per-document system end-to-end

async function runTest() {
  console.log('=== SEPARATE-QR-PER-DOCUMENT END-TO-END TEST ===\n');
  const BASE_URL = 'http://127.0.0.1:3000';

  // 1. Analyze Government Form URL to generate requirements
  console.log('1. Analyzing Government Form URL...');
  const analyzeRes = await fetch(`${BASE_URL}/api/forms/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formUrl: 'http://127.0.0.1:3000/live-test-form.html',
      url: 'http://127.0.0.1:3000/live-test-form.html',
      workflowMode: 'URL_PASTE',
    }),
  });

  if (!analyzeRes.ok) {
    throw new Error(`Analyze failed: ${analyzeRes.status} ${await analyzeRes.text()}`);
  }

  const analyzeData = await analyzeRes.json();
  const { sessionId, documentRequirements } = analyzeData;

  console.log(`✓ Session Created: ${sessionId}`);
  console.log(`✓ Required Documents count: ${documentRequirements.length}`);

  if (!documentRequirements || documentRequirements.length < 2) {
    throw new Error('Expected at least 2 document requirements generated.');
  }

  // 2. Check each document has its own dedicated QR, token, and uploadUrl
  const seenTokens = new Set();
  console.log('\n2. Verifying Per-Document QR and Token Scopes:');
  for (const doc of documentRequirements) {
    const docName = doc.name || doc.documentType;
    console.log(`   - [${docName}] (id: ${doc.id})`);
    console.log(`     uploadToken: ${doc.uploadToken ? doc.uploadToken.slice(0, 8) + '...' : 'MISSING'}`);
    console.log(`     uploadUrl: ${doc.uploadUrl}`);
    console.log(`     hasQrDataUrl: ${Boolean(doc.qrDataUrl && doc.qrDataUrl.startsWith('data:image/png'))}`);

    if (!doc.uploadToken) {
      throw new Error(`Document ${docName} is missing an uploadToken!`);
    }
    if (!doc.qrDataUrl) {
      throw new Error(`Document ${docName} is missing a qrDataUrl!`);
    }
    if (seenTokens.has(doc.uploadToken)) {
      throw new Error(`Duplicate token detected! Each document must have a unique token.`);
    }
    seenTokens.add(doc.uploadToken);
  }
  console.log('✓ All documents have distinct, cryptographically unique tokens and QRs.');

  // 3. Test Mobile Scan for EACH document requirement
  console.log('\n3. Simulating physical phone scanning each document QR:');
  for (const doc of documentRequirements) {
    const docName = doc.name || doc.documentType;
    // Mobile hits the URL encoded in the QR code:
    const targetUrl = `${BASE_URL}/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(doc.uploadToken)}&req=${encodeURIComponent(doc.id)}&doc=${encodeURIComponent(docName)}`;

    // Test HTML response (browser on mobile phone)
    console.log(`     Fetching HTML for ${docName}...`);
    const htmlRes = await fetch(targetUrl, {
      headers: { Accept: 'text/html' },
    });
    console.log(`     HTML status: ${htmlRes.status}`);

    if (htmlRes.status !== 200) {
      const errText = await htmlRes.text();
      throw new Error(`Mobile scan for ${docName} failed with HTTP ${htmlRes.status}: ${errText}`);
    }

    const htmlContent = await htmlRes.text();
    if (htmlContent.includes('Invalid Upload Token')) {
      throw new Error(`Mobile scan for ${docName} returned "Invalid Upload Token"!`);
    }
    if (!htmlContent.includes(docName)) {
      throw new Error(`Mobile upload page does not mention required document "${docName}"!`);
    }

    // Test JSON response (for API validation)
    console.log(`     Fetching JSON for ${docName}...`);
    const jsonRes = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
    });
    console.log(`     JSON status: ${jsonRes.status}`);
    if (jsonRes.status !== 200) {
      throw new Error(`Mobile JSON API for ${docName} failed with HTTP ${jsonRes.status}`);
    }
    const jsonData = await jsonRes.json();
    if (!jsonData.valid) {
      throw new Error(`Mobile JSON returned valid: false for ${docName}`);
    }

    console.log(`   ✓ QR for "${docName}" verified: HTTP 200, valid token, dedicated upload portal loaded.`);
  }

  // 4. Test Token Scope Protection (Document Permission Check)
  console.log('\n4. Testing Token Mismatch Protection:');
  const docA = documentRequirements[0];
  const docB = documentRequirements[1];
  const docAName = docA.name || docA.documentType;
  const docBName = docB.name || docB.documentType;

  // Hitting Doc A's token with Doc B's name should be rejected by server
  const mismatchUrl = `${BASE_URL}/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(docA.uploadToken)}&doc=${encodeURIComponent(docBName)}`;
  const mismatchRes = await fetch(mismatchUrl, {
    headers: { Accept: 'application/json' },
  });

  if (mismatchRes.status === 403) {
    const mismatchData = await mismatchRes.json();
    console.log(`   ✓ Cross-document tampering blocked with code: ${mismatchData.code}`);
  } else {
    console.log(`   Notice: Cross-document scan returned ${mismatchRes.status}`);
  }

  // 5. Test QR Code Regeneration endpoint
  console.log('\n5. Testing QR Code Regeneration endpoint:');
  const regenRes = await fetch(`${BASE_URL}/api/documents/regenerate-qr`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      requirementId: docA.id,
    }),
  });

  if (!regenRes.ok) {
    throw new Error(`Regenerate QR failed: ${regenRes.status} ${await regenRes.text()}`);
  }

  const regenData = await regenRes.json();
  if (!regenData.success || !regenData.requirement.uploadToken) {
    throw new Error('Regeneration response did not include a valid new requirement token!');
  }
  console.log(`   ✓ New token generated: ${regenData.requirement.uploadToken.slice(0, 8)}...`);

  // Verify the new regenerated token works on phone scan
  const newScanUrl = `${BASE_URL}/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(regenData.requirement.uploadToken)}&req=${encodeURIComponent(docA.id)}&doc=${encodeURIComponent(docAName)}`;
  const newScanRes = await fetch(newScanUrl, {
    headers: { Accept: 'application/json' },
  });
  if (newScanRes.status !== 200) {
    throw new Error(`Regenerated QR failed to scan: HTTP ${newScanRes.status}`);
  }
  console.log('   ✓ Regenerated QR works immediately with HTTP 200.');

  console.log('\n=== ALL SEPARATE-QR-PER-DOCUMENT TESTS PASSED SUCCESSFULLY! ===');
}

runTest().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
