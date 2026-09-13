import assert from 'assert';

async function runTests() {
  console.log('=== RUNNING SMARTFORM AI SINGLE QR + MULTI-DOC VERIFICATION ===\n');

  // TEST 1: URL_PASTE Mode
  console.log('[TEST 1] Testing URL_PASTE mode...');
  const res1 = await fetch('http://localhost:3000/api/forms/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowMode: 'URL_PASTE',
      formUrl: 'https://upsc.gov.in/online-application/civil-services-exam-2026',
      pastedUrl: 'https://upsc.gov.in/online-application/civil-services-exam-2026',
      detectedFields: [
        { name: 'candidate_name', label: 'Candidate Full Name', fieldType: 'text', required: true },
        { name: 'father_name', label: 'Father Name', fieldType: 'text', required: true },
        { name: 'dob', label: 'Date of Birth (10th standard)', fieldType: 'date', required: true },
        { name: 'intermediate_roll', label: 'Intermediate 12th Roll Number', fieldType: 'text', required: true },
        { name: 'graduation_degree', label: 'Graduation Degree / Major', fieldType: 'text', required: true },
        { name: 'category', label: 'Category / Caste (SC/ST/OBC/EWS)', fieldType: 'select', required: true },
        { name: 'annual_income', label: 'Family Annual Income', fieldType: 'number', required: false },
        { name: 'candidate_photo', label: 'Candidate Photograph', fieldType: 'file', required: true },
        { name: 'candidate_signature', label: 'Candidate Signature', fieldType: 'file', required: true }
      ]
    })
  });

  const data1 = await res1.json();
  assert.strictEqual(res1.status, 200, 'Expected HTTP 200 from /api/forms/analyze');
  assert.ok(data1.sessionId, 'Missing sessionId');
  assert.ok(data1.sessionUploadToken, 'Missing sessionUploadToken');
  assert.ok(data1.sessionQrDataUrl, 'Missing sessionQrDataUrl');
  assert.ok(data1.sessionUploadUrl, 'Missing sessionUploadUrl');
  assert.ok(Array.isArray(data1.documentRequirements), 'documentRequirements must be an array');
  console.log(`[TEST 1] Form Title: "${data1.formTitle}"`);
  console.log(`[TEST 1] Document requirements count: ${data1.documentRequirements.length}`);
  console.log('[TEST 1] Documents required:', data1.documentRequirements.map(d => d.documentType).join(', '));
  assert.ok(data1.documentRequirements.length >= 6, `Expected at least 6 required documents, got ${data1.documentRequirements.length}`);

  // Verify that ALL document requirements share the exact same uploadToken and uploadUrl
  const firstToken = data1.documentRequirements[0].uploadToken;
  const firstUrl = data1.documentRequirements[0].uploadUrl;
  for (const doc of data1.documentRequirements) {
    assert.strictEqual(doc.uploadToken, firstToken, `Document ${doc.documentType} must have identical token`);
    assert.strictEqual(doc.uploadUrl, firstUrl, `Document ${doc.documentType} must have identical uploadUrl`);
  }
  console.log('[TEST 1] ✓ Verified: EXACTLY ONE unified QR code/token generated for all documents.');

  // TEST 1b: Mobile Phone scans the QR code (GET /upload?session=...&token=...)
  console.log('[TEST 1b] Simulating phone scan on /upload...');
  const mobileRes1 = await fetch(data1.sessionUploadUrl);
  assert.strictEqual(mobileRes1.status, 200, 'Expected HTTP 200 when phone accesses /upload');
  const mobileHtml1 = await mobileRes1.text();

  // Verify that ALL required documents appear in the mobile upload page HTML
  for (const doc of data1.documentRequirements) {
    assert.ok(
      mobileHtml1.includes(doc.documentType),
      `Mobile page must contain document requirement: ${doc.documentType}`
    );
  }
  console.log(`[TEST 1b] ✓ Verified: Mobile upload page contains all ${data1.documentRequirements.length} required documents!`);

  // TEST 2: EXTENSION_INSPECTION Mode
  console.log('\n[TEST 2] Testing EXTENSION_INSPECTION mode...');
  const res2 = await fetch('http://localhost:3000/api/forms/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workflowMode: 'EXTENSION_INSPECTION',
      inspectedUrl: 'https://ssc.nic.in/portal/apply/cgl2026',
      formUrl: 'https://ssc.nic.in/portal/apply/cgl2026',
      pageTitle: 'SSC Combined Graduate Level Examination 2026',
      targetTabId: 42,
      targetWindowId: 1,
      targetOrigin: 'https://ssc.nic.in',
      detectedFields: [
        { name: 'aadhaar_no', label: 'Aadhaar Number', fieldType: 'text', required: true },
        { name: 'name', label: 'Candidate Name (as per matriculation)', fieldType: 'text', required: true },
        { name: 'father_name', label: 'Father Name', fieldType: 'text', required: true },
        { name: 'matric_roll', label: 'Matriculation (10th) Roll No', fieldType: 'text', required: true },
        { name: 'inter_roll', label: '12th Standard Roll No', fieldType: 'text', required: true },
        { name: 'degree', label: 'Graduation Degree', fieldType: 'text', required: true },
        { name: 'caste', label: 'Caste Certificate Category', fieldType: 'text', required: true },
        { name: 'income', label: 'Income Certificate', fieldType: 'text', required: false },
        { name: 'photo', label: 'Recent Photograph', fieldType: 'file', required: true },
        { name: 'sign', label: 'Signature', fieldType: 'file', required: true }
      ]
    })
  });

  const data2 = await res2.json();
  assert.strictEqual(res2.status, 200, 'Expected HTTP 200 from /api/forms/analyze in extension mode');
  assert.strictEqual(data2.workflowMode, 'EXTENSION_INSPECTION');
  assert.strictEqual(data2.targetTabId, 42);
  assert.ok(data2.sessionId);
  assert.ok(data2.sessionUploadToken);
  assert.ok(data2.sessionQrDataUrl);
  assert.ok(data2.sessionUploadUrl);
  console.log(`[TEST 2] Document requirements count: ${data2.documentRequirements.length}`);
  console.log('[TEST 2] Documents required:', data2.documentRequirements.map(d => d.documentType).join(', '));
  assert.ok(data2.documentRequirements.length >= 6);

  // Verify single QR token
  for (const doc of data2.documentRequirements) {
    assert.strictEqual(doc.uploadToken, data2.sessionUploadToken, `Doc ${doc.documentType} must share sessionUploadToken`);
  }
  console.log('[TEST 2] ✓ Verified: EXTENSION_INSPECTION mode generates ONE SINGLE QR for the entire session!');

  // TEST 2b: Mobile Phone scans the QR code for EXTENSION_INSPECTION session
  console.log('[TEST 2b] Simulating phone scan on extension session /upload...');
  const mobileRes2 = await fetch(data2.sessionUploadUrl);
  assert.strictEqual(mobileRes2.status, 200);
  const mobileHtml2 = await mobileRes2.text();
  for (const doc of data2.documentRequirements) {
    assert.ok(
      mobileHtml2.includes(doc.documentType),
      `Mobile page must contain document requirement: ${doc.documentType}`
    );
  }
  console.log(`[TEST 2b] ✓ Verified: Mobile upload page shows all ${data2.documentRequirements.length} documents for EXTENSION_INSPECTION mode!`);

  // TEST 3: Multi-document upload using the single session token
  console.log('\n[TEST 3] Testing multi-document upload with single session token...');
  const token = data2.sessionUploadToken;
  const sessionId = data2.sessionId;
  const doc1 = data2.documentRequirements[0];
  const doc2 = data2.documentRequirements[1];

  // Upload Doc 1
  const formData1 = new FormData();
  const file1 = new Blob(['Mock Aadhaar PDF Content'], { type: 'application/pdf' });
  formData1.append('document', file1, 'aadhaar_card.pdf');
  formData1.append('session', sessionId);
  formData1.append('token', token);
  formData1.append('requirementId', doc1.id);
  formData1.append('documentType', doc1.documentType);

  const uploadRes1 = await fetch('http://localhost:3000/api/upload', {
    method: 'POST',
    body: formData1,
  });
  const uploadJson1 = await uploadRes1.json();
  assert.strictEqual(uploadRes1.status, 200, `Upload doc 1 failed: ${JSON.stringify(uploadJson1)}`);
  assert.ok(uploadJson1.success, 'Upload 1 must be success');
  console.log(`[TEST 3] Uploaded Document 1 (${doc1.documentType}) successfully!`);

  // Upload Doc 2 using the SAME token (must NOT be rejected as consumed)
  const formData2 = new FormData();
  const file2 = new Blob(['Mock Marksheet PDF Content'], { type: 'application/pdf' });
  formData2.append('document', file2, 'marksheet_10th.pdf');
  formData2.append('session', sessionId);
  formData2.append('token', token);
  formData2.append('requirementId', doc2.id);
  formData2.append('documentType', doc2.documentType);

  const uploadRes2 = await fetch('http://localhost:3000/api/upload', {
    method: 'POST',
    body: formData2,
  });
  const uploadJson2 = await uploadRes2.json();
  assert.strictEqual(uploadRes2.status, 200, `Upload doc 2 failed: ${JSON.stringify(uploadJson2)}`);
  assert.ok(uploadJson2.success, 'Upload 2 must be success with same token');
  console.log(`[TEST 3] Uploaded Document 2 (${doc2.documentType}) with SAME session token successfully!`);

  // Check session state via /api/sessions/:id
  const sessionCheckRes = await fetch(`http://localhost:3000/api/sessions/${sessionId}`);
  const sessionData = await sessionCheckRes.json();
  assert.strictEqual(sessionCheckRes.status, 200);
  const updatedDoc1 = sessionData.documentRequirements.find(d => d.id === doc1.id);
  const updatedDoc2 = sessionData.documentRequirements.find(d => d.id === doc2.id);
  assert.ok(updatedDoc1 && updatedDoc1.status !== 'pending', 'Doc 1 status must be updated');
  assert.ok(updatedDoc2 && updatedDoc2.status !== 'pending', 'Doc 2 status must be updated');
  console.log(`[TEST 3] Session status verified: Doc 1 = ${updatedDoc1.status}, Doc 2 = ${updatedDoc2.status}`);

  console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
});
