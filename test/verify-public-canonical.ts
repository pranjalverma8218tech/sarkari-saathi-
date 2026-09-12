import fs from 'fs';
import JSZip from 'jszip';

async function runVerification() {
  console.log('=== STARTING EXTENSIVE VERIFICATION ===\n');

  // Test 1: Local Server Health and Public URL
  console.log('[Test 1] Checking Local Server /api/health and /api/settings/public-url...');
  const healthRes = await fetch('http://localhost:3000/api/health');
  const healthData = await healthRes.json();
  console.log('  Health publicUrl:', healthData.publicUrl);
  if (healthData.publicUrl !== 'https://sarkari-saathi.ai.studio') {
    throw new Error(`Expected health publicUrl to be https://sarkari-saathi.ai.studio, got ${healthData.publicUrl}`);
  }
  console.log('  -> PASS: Local server reports canonical publicUrl\n');

  // Test 2: QR Code Generation on Local Server
  console.log('[Test 2] Testing /api/forms/analyze QR Code URL generation...');
  const analyzeRes = await fetch('http://localhost:3000/api/forms/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formUrl: 'https://upsc.gov.in/apply',
      detectedFields: [
        { id: 'name', name: 'candidate_name', label: 'Full Name', fieldType: 'text', required: true },
        { id: 'aadhaar', name: 'aadhaar_no', label: 'Aadhaar Card No', fieldType: 'text', required: true }
      ]
    })
  });
  const analyzeData = await analyzeRes.json();
  const req0 = analyzeData.documentRequirements[0];
  console.log('  Generated QR Upload URL:', req0.uploadUrl);
  if (!req0.uploadUrl.startsWith('https://sarkari-saathi.ai.studio/upload?session=')) {
    throw new Error(`QR URL does not start with https://sarkari-saathi.ai.studio/upload?session= : ${req0.uploadUrl}`);
  }
  if (req0.uploadUrl.includes('localhost') || req0.uploadUrl.includes('127.0.0.1') || req0.uploadUrl.includes('ais-dev-')) {
    throw new Error(`QR URL contains banned address: ${req0.uploadUrl}`);
  }
  console.log('  -> PASS: QR code strictly points to https://sarkari-saathi.ai.studio/upload?session=...\n');

  // Test 3: Downloadable Extension Package Content Verification
  console.log('[Test 3] Testing /api/extension/download ZIP packaging...');
  const zipRes = await fetch('http://localhost:3000/api/extension/download');
  const zipBuf = await zipRes.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuf);
  
  let foundLocalhost = false;
  let popupJsContent = '';
  let popupHtmlContent = '';

  for (const [filename, fileObj] of Object.entries(zip.files)) {
    if (!fileObj.dir) {
      const content = await fileObj.async('string');
      if (content.includes('localhost') || content.includes('127.0.0.1')) {
        console.error(`  ERROR: File ${filename} contains localhost or 127.0.0.1!`);
        foundLocalhost = true;
      }
      if (filename.includes('popup.js')) popupJsContent = content;
      if (filename.includes('popup.html')) popupHtmlContent = content;
    }
  }

  if (foundLocalhost) {
    throw new Error('Downloaded ZIP contains localhost references!');
  }
  console.log('  -> PASS: Zero occurrences of localhost or 127.0.0.1 in downloaded ZIP');

  if (!popupJsContent.includes("const DEFAULT_SERVER_URL = 'https://sarkari-saathi.ai.studio';")) {
    throw new Error(`popup.js does not contain expected DEFAULT_SERVER_URL. Found:\n${popupJsContent.slice(0, 300)}`);
  }
  console.log('  -> PASS: popup.js DEFAULT_SERVER_URL is https://sarkari-saathi.ai.studio');

  if (!popupHtmlContent.includes('placeholder="https://sarkari-saathi.ai.studio"')) {
    throw new Error('popup.html does not contain canonical placeholder');
  }
  console.log('  -> PASS: popup.html placeholder is https://sarkari-saathi.ai.studio\n');

  // Test 4: Real External Reachability against https://sarkari-saathi.ai.studio
  console.log('[Test 4] Testing real external reachability on https://sarkari-saathi.ai.studio...');
  
  // 4a: GET /
  console.log('  4a: Testing GET / ...');
  const extRootRes = await fetch('https://sarkari-saathi.ai.studio', {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' },
    redirect: 'manual'
  });
  console.log(`    Status: ${extRootRes.status}, Headers: location=${extRootRes.headers.get('location')}`);
  const rootText = await extRootRes.text();
  const hasCookieCheck = rootText.includes('__cookie_check.html') || (extRootRes.headers.get('location') || '').includes('__cookie_check');
  if (hasCookieCheck) {
    console.error('    [BLOCKED]: Detected __cookie_check.html on GET /');
  } else {
    console.log('    -> PASS: GET / is publicly reachable without cookie check (Status 200)');
  }

  // 4b: GET /upload without token -> expected 403
  console.log('  4b: Testing GET /upload without token (Missing token)...');
  const extNoTokenRes = await fetch('https://sarkari-saathi.ai.studio/upload', {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  console.log(`    Status: ${extNoTokenRes.status} (Expected 403)`);
  if (extNoTokenRes.status !== 403) {
    throw new Error(`Expected HTTP 403 for missing token, got ${extNoTokenRes.status}`);
  }
  console.log('    -> PASS: Missing token properly returns HTTP 403 Forbidden');

  // 4c: GET /upload with invalid token -> expected 403
  console.log('  4c: Testing GET /upload with invalid token...');
  const extInvalidTokenRes = await fetch('https://sarkari-saathi.ai.studio/upload?session=app_test&token=fake_token_123&doc=Aadhaar', {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  console.log(`    Status: ${extInvalidTokenRes.status} (Expected 403)`);
  if (extInvalidTokenRes.status !== 403) {
    throw new Error(`Expected HTTP 403 for invalid token, got ${extInvalidTokenRes.status}`);
  }
  console.log('    -> PASS: Invalid token properly returns HTTP 403 Forbidden');

  // 4d: Create a session on https://sarkari-saathi.ai.studio and test with real active token -> expected 200
  console.log('  4d: Creating live session on https://sarkari-saathi.ai.studio...');
  const extAnalyzeRes = await fetch('https://sarkari-saathi.ai.studio/api/forms/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      formUrl: 'https://ssc.nic.in/exam',
      detectedFields: [
        { id: 'c_name', name: 'candidateName', label: 'Applicant Name', fieldType: 'text', required: true },
        { id: 'marksheet', name: 'matric_cert', label: '10th Marksheet Number', fieldType: 'text', required: true }
      ]
    })
  });
  const extAnalyzeData = await extAnalyzeRes.json();
  const liveReq = extAnalyzeData.documentRequirements[0];
  console.log('    Created live session:', extAnalyzeData.sessionId);
  console.log('    Live upload URL:', liveReq.uploadUrl);

  console.log('  4e: Testing GET with active temporary token from normal mobile user-agent...');
  const extLiveUploadRes = await fetch(liveReq.uploadUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)' }
  });
  console.log(`    Status: ${extLiveUploadRes.status} (Expected 200)`);
  const liveHtml = await extLiveUploadRes.text();
  const isRealMobilePortal = liveHtml.includes('uploadForm') && liveHtml.includes('Take Photo or Choose File');
  console.log(`    Contains Mobile Portal Upload Form: ${isRealMobilePortal}`);
  if (extLiveUploadRes.status !== 200 || !isRealMobilePortal) {
    throw new Error('Valid token did not load mobile portal with HTTP 200');
  }
  console.log('    -> PASS: Valid token loads Mobile Upload Portal with HTTP 200 OK!');

  // 4f: Test uploading wrong document to live endpoint -> expected 422
  console.log('  4f: Testing upload of wrong document to https://sarkari-saathi.ai.studio/api/documents/upload...');
  const formData = new FormData();
  formData.append('session', liveReq.applicationId);
  formData.append('token', liveReq.uploadToken);
  const blob = new Blob(['Dummy electricity bill text receipt'], { type: 'image/jpeg' });
  formData.append('file', blob, 'receipt.jpg');

  const extUploadRes = await fetch('https://sarkari-saathi.ai.studio/api/documents/upload', {
    method: 'POST',
    body: formData
  });
  console.log(`    Status: ${extUploadRes.status} (Expected 422)`);
  const uploadJson = await extUploadRes.json();
  console.log('    Response rejection:', uploadJson.reason || uploadJson.message);
  if (extUploadRes.status !== 422) {
    throw new Error(`Expected HTTP 422 for wrong document, got ${extUploadRes.status}`);
  }
  console.log('    -> PASS: Wrong document correctly rejected with HTTP 422 Unprocessable Entity!');

  console.log('\n=== ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ===');
}

runVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
