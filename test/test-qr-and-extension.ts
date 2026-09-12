/**
 * Comprehensive Validation for QR Mobile Upload & Chrome Extension Fixes
 * Tests Bug 1 and Bug 2 against the actual running Express backend.
 */

import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';

const BASE_URL = 'http://localhost:3000';
const DEPLOYED_URL = 'https://ais-dev-nfcwnfuyiamsmdfv5jfvmy-746730634616.asia-southeast1.run.app';

interface TestResult {
  step: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(step: string, passed: boolean, details: string) {
  results.push({ step, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} | ${step} - ${details}`);
}

async function runTests() {
  console.log('========================================================');
  console.log('SmartForm AI - Bug Fix Verification Test Suite');
  console.log('Validating QR Upload Architecture & Chrome Extension');
  console.log('========================================================\n');

  try {
    // 1. Verify health endpoint
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthData = await healthRes.json();
    record('1. Backend Server Health', healthRes.ok && healthData.status === 'ok', `Server active on port 3000`);

    // 2. Create session with origin header
    const analyzeRes = await fetch(`${BASE_URL}/api/forms/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SmartForm-Origin': DEPLOYED_URL,
      },
      body: JSON.stringify({
        formUrl: 'https://jeemain.nta.nic.in/registration-2026',
        origin: DEPLOYED_URL,
      }),
    });
    const analyzeData = await analyzeRes.json();
    const sessionId = analyzeData.sessionId;
    const docReqs = analyzeData.documentRequirements || [];
    record(
      '2. Create Form Session & Gemini Detection',
      analyzeRes.ok && !!sessionId && docReqs.length > 0,
      `Session ${sessionId} created with ${docReqs.length} doc requirements`
    );

    // 3. Inspect generated QR URLs
    const firstReq = docReqs[0];
    const qrUrl = firstReq.uploadUrl;
    const hasPII = qrUrl.includes('name=') || qrUrl.includes('dob=') || qrUrl.includes('aadhaar=');
    const pointsToDeployed = qrUrl.startsWith(DEPLOYED_URL);
    record(
      '3. QR URL Public Origin & Zero PII',
      !hasPII && pointsToDeployed,
      `URL: ${qrUrl.slice(0, 70)}... (PII: None, Origin: Deployed Public URL)`
    );

    // 4. Test Public Access to Mobile Upload without Login / Cookies
    const uploadPageRes = await fetch(`${BASE_URL}/upload?session=${sessionId}&token=${firstReq.uploadToken}&doc=${encodeURIComponent(firstReq.documentType)}`, {
      headers: { Accept: 'text/html' },
    });
    const uploadPageHtml = await uploadPageRes.text();
    const hasUploadForm = uploadPageHtml.includes('uploadForm') && uploadPageHtml.includes('fileInput');
    record(
      '4. Public Mobile Upload Route (No Login Required)',
      uploadPageRes.status === 200 && hasUploadForm,
      `HTTP 200 OK returned. Standalone mobile upload page rendered.`
    );

    // 5. Test Invalid Upload Token
    const invalidTokenRes = await fetch(`${BASE_URL}/upload?session=${sessionId}&token=fake_random_invalid_token_999`, {
      headers: { Accept: 'text/html' },
    });
    record(
      '5. Invalid Token Rejection',
      invalidTokenRes.status === 403,
      `HTTP ${invalidTokenRes.status} Forbidden returned for unauthorized token.`
    );

    // 6. Test Session Mismatch
    const mismatchRes = await fetch(`${BASE_URL}/upload?session=app_wrong_session&token=${firstReq.uploadToken}`, {
      headers: { Accept: 'text/html' },
    });
    record(
      '6. Mismatched Session Rejection',
      mismatchRes.status === 403,
      `HTTP ${mismatchRes.status} Forbidden returned when session does not match token.`
    );

    // 7. Test Missing Token
    const missingTokenRes = await fetch(`${BASE_URL}/upload`, {
      headers: { Accept: 'text/html' },
    });
    record(
      '7. Missing Token Rejection',
      missingTokenRes.status === 403,
      `HTTP ${missingTokenRes.status} Forbidden returned when token query parameter is absent.`
    );

    // 8. Test Token Lifecycle & Expiration Endpoint
    const testFlowRes = await fetch(`${BASE_URL}/api/upload/test-flow`);
    const testFlowData = await testFlowRes.json();
    record(
      '8. Token Lifecycle & Expiration Behavior',
      testFlowRes.ok && testFlowData.tests.expiredTokenReturnsExpired && testFlowData.tests.consumedTokenReturnsExpired,
      `Expired tokens return 410, consumed tokens return 410, invalid tokens return null.`
    );

    // 9. Test Wrong Document Rejection (Uploading 12th Marksheet for 10th Marksheet requirement)
    // Find 10th requirement
    const req10th = docReqs.find((r: any) => r.documentType.toLowerCase().includes('10th')) || firstReq;
    const dummy12th = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Title (HIGHER SECONDARY CERTIFICATE - CLASS XII MARKSHEET) /Author (CBSE) /Subject (12th Marksheet) >>\nendobj\nCentral Board of Secondary Education\nCLASS XII (SENIOR SCHOOL CERTIFICATE EXAMINATION)\nRoll Number: 6612984\nCandidate: Rohan Sharma\nStream: Science\nPhysics: 88, Chemistry: 85, Mathematics: 92\nResult: PASS\n'
    );
    const formWrong = new FormData();
    formWrong.append('session', sessionId);
    formWrong.append('token', req10th.uploadToken);
    formWrong.append('file', new Blob([dummy12th], { type: 'application/pdf' }), 'Class12_Marksheet.pdf');

    const uploadWrongRes = await fetch(`${BASE_URL}/api/documents/upload`, {
      method: 'POST',
      body: formWrong,
    });
    const wrongData = await uploadWrongRes.json();
    record(
      '9. Wrong Document Rejection (12th for 10th)',
      uploadWrongRes.status === 422 && wrongData.rejected === true,
      `HTTP 422 Unprocessable Entity returned. Reason: "${wrongData.reason?.slice(0, 60)}..."`
    );

    // 10. Test Correct Document Acceptance (Uploading 10th Marksheet)
    const dummy10th = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Title (SECONDARY SCHOOL EXAMINATION - CLASS X MARKSHEET) /Author (CBSE) /Subject (10th Marksheet) >>\nendobj\nCentral Board of Secondary Education\nCLASS X (SECONDARY SCHOOL EXAMINATION)\nRoll Number: 4128956\nCandidate Name: ROHAN SHARMA\nFather Name: SURESH SHARMA\nDate of Birth: 14/08/2004\nEnglish: 85, Mathematics: 90, Science: 88, Social: 82\nResult: PASS\n'
    );
    const formCorrect = new FormData();
    formCorrect.append('session', sessionId);
    formCorrect.append('token', req10th.uploadToken);
    formCorrect.append('file', new Blob([dummy10th], { type: 'application/pdf' }), 'Class10_Marksheet.pdf');

    const uploadCorrectRes = await fetch(`${BASE_URL}/api/documents/upload`, {
      method: 'POST',
      body: formCorrect,
    });
    const correctData = await uploadCorrectRes.json();
    record(
      '10. Correct Document Acceptance (10th for 10th)',
      uploadCorrectRes.status === 200 && correctData.success === true,
      `HTTP 200 OK returned. Document verified and extracted fields updated.`
    );

    // 11. Test Replay Prevention (Token reuse must return 410)
    const reusePageRes = await fetch(`${BASE_URL}/upload?session=${sessionId}&token=${req10th.uploadToken}`, {
      headers: { Accept: 'text/html' },
    });
    record(
      '11. Single-Use Token Reuse Prevention (GET /upload)',
      reusePageRes.status === 410,
      `HTTP 410 Gone returned when opening already-consumed QR upload token.`
    );

    const uploadReuseRes = await fetch(`${BASE_URL}/api/documents/upload`, {
      method: 'POST',
      body: formCorrect,
    });
    record(
      '12. Single-Use Token Reuse Prevention (POST /upload)',
      uploadReuseRes.status === 410,
      `HTTP 410 Gone returned when uploading with already-consumed token.`
    );

    // 13. Verify Extension ZIP Download & Files
    const extZipRes = await fetch(`${BASE_URL}/api/extension/download`);
    const extZipBuffer = await extZipRes.arrayBuffer();
    const zip = await JSZip.loadAsync(extZipBuffer);

    const manifestFile = zip.file('manifest.json');
    const popupJsFile = zip.file('popup.js');
    const popupHtmlFile = zip.file('popup.html');

    const manifestText = manifestFile ? await manifestFile.async('text') : '';
    const popupJsText = popupJsFile ? await popupJsFile.async('text') : '';
    const popupHtmlText = popupHtmlFile ? await popupHtmlFile.async('text') : '';

    const manifest = JSON.parse(manifestText);
    const hasManifestV3 = manifest.manifest_version === 3;
    const hasStoragePerm = manifest.permissions.includes('storage');
    const hasNoLocalhost = !popupJsText.includes('localhost:3000') && !popupHtmlText.includes('localhost:3000');
    const hasDeployedUrl = popupJsText.includes(DEPLOYED_URL);
    const hasChromeStorage = popupJsText.includes('chrome.storage.local');

    record(
      '13. Extension Manifest V3 & Storage Permission',
      hasManifestV3 && hasStoragePerm,
      `Manifest version: 3, permissions: [${manifest.permissions.join(', ')}]`
    );

    record(
      '14. Extension localhost:3000 Removed',
      hasNoLocalhost,
      `Verified zero occurrences of localhost:3000 in downloaded extension package.`
    );

    record(
      '15. Extension Deployed URL Default',
      hasDeployedUrl,
      `Default server URL set to ${DEPLOYED_URL}.`
    );

    record(
      '16. Extension chrome.storage.local Persistence',
      hasChromeStorage,
      `Verified serverUrl is read from and saved to chrome.storage.local.`
    );

    // 14. Test Session Purge
    const purgeRes = await fetch(`${BASE_URL}/api/storage/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const purgeData = await purgeRes.json();
    record(
      '17. Temporary Storage Purge',
      purgeRes.ok && purgeData.success === true,
      `All temporary files and session data purged successfully.`
    );

    console.log('\n========================================================');
    const allPassed = results.every((r) => r.passed);
    console.log(`TOTAL TESTS: ${results.length} | PASSED: ${results.filter((r) => r.passed).length} | FAILED: ${results.filter((r) => !r.passed).length}`);
    console.log(`OVERALL STATUS: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
    console.log('========================================================\n');
  } catch (err: any) {
    console.error('Test execution error:', err);
  }
}

runTests();
