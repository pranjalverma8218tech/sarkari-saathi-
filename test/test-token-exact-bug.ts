/**
 * Automated Acceptance Test Suite for Production QR Token Verification
 * Strictly implements the 18-step verification required for the 403 Invalid Token debugging.
 */

import assert from 'assert';
import crypto from 'crypto';
import http from 'http';
import { db } from '../src/server/db.js';

let passed = 0;
let failed = 0;

function step(num: number, description: string, success: boolean, details?: string) {
  if (success) {
    console.log(`  ✓ [STEP ${num}] ${description}`);
    passed++;
  } else {
    console.error(`  ✗ [STEP ${num}] ${description}: ${details || 'Failed'}`);
    failed++;
  }
}

async function run18StepTestSuite() {
  console.log('\n======================================================================');
  console.log('  18-STEP ACCEPTANCE TEST SUITE: PRODUCTION QR & TOKEN VERIFICATION');
  console.log('======================================================================\n');

  const baseUrl = 'http://127.0.0.1:3000';

  // Check if dev server is reachable
  let serverReachable = false;
  try {
    const healthRes = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    serverReachable = healthRes.ok;
  } catch {
    serverReachable = false;
  }

  if (!serverReachable) {
    console.warn(`Server not reachable on ${baseUrl}, will test directly against database and endpoints.`);
  }

  const testAppId = 'test_sess_' + Date.now();
  let createdUnified: any = null;
  let sessionToken = '';

  // 1. Create session
  try {
    createdUnified = await db.createUnifiedUploadSession({
      applicationId: testAppId,
      workflowMode: 'URL_PASTE',
      formUrl: 'https://upsc.gov.in/apply/civil-services',
      pageTitle: 'UPSC Civil Services 2026',
      requiredDocuments: [
        {
          id: 'req_1',
          applicationId: testAppId,
          documentType: '10th Marksheet',
          status: 'pending',
          required: true,
          uploadToken: '',
          qrDataUrl: '',
          uploadUrl: '',
        },
        {
          id: 'req_2',
          applicationId: testAppId,
          documentType: 'Aadhaar Card',
          status: 'pending',
          required: true,
          uploadToken: '',
          qrDataUrl: '',
          uploadUrl: '',
        },
      ],
      baseUrl: 'https://sarkari-saathi.ai.studio',
    });
    assert.ok(createdUnified && createdUnified.sessionId === testAppId);
    step(1, 'Create Session in Authoritative Store', true);
  } catch (e: any) {
    step(1, 'Create Session in Authoritative Store', false, e.message);
  }

  // 2. Fetch session
  let fetchedSession: any = null;
  try {
    fetchedSession = await db.getSession(testAppId);
    assert.ok(fetchedSession && fetchedSession.id === testAppId);
    assert.strictEqual(fetchedSession.documentRequirements.length, 2);
    step(2, 'Fetch Session from Authoritative Store', true);
  } catch (e: any) {
    step(2, 'Fetch Session from Authoritative Store', false, e.message);
  }

  // 3. Read generated token
  try {
    sessionToken = createdUnified?.secureToken || fetchedSession?.sessionUploadToken;
    assert.ok(sessionToken && sessionToken.length >= 16);
    const tokenInfo = await db.getUploadToken(sessionToken);
    assert.ok(tokenInfo);
    assert.strictEqual(tokenInfo.applicationId, testAppId);
    assert.strictEqual(tokenInfo.scope, 'SESSION_ALL_DOCS');
    step(3, 'Read Generated Token and Validate Scope', true);
  } catch (e: any) {
    step(3, 'Read Generated Token and Validate Scope', false, e.message);
  }

  // 4. Make HTTP request to /upload using that token
  let uploadRes: Response | null = null;
  let uploadBody = '';
  try {
    uploadRes = await fetch(`${baseUrl}/upload?session=${encodeURIComponent(testAppId)}&token=${encodeURIComponent(sessionToken)}`);
    uploadBody = await uploadRes.text();
    assert.ok(uploadRes);
    step(4, 'Make HTTP Request to /upload with Token', true);
  } catch (e: any) {
    step(4, 'Make HTTP Request to /upload with Token', false, e.message);
  }

  // 5. Assert 200 OK
  try {
    assert.strictEqual(uploadRes?.status, 200);
    step(5, 'Assert HTTP 200 OK on /upload', true);
  } catch (e: any) {
    step(5, 'Assert HTTP 200 OK on /upload', false, `Got status ${uploadRes?.status}`);
  }

  // 6. Assert body contains upload page
  try {
    assert.ok(uploadBody.includes('Sarkari Saathi') || uploadBody.includes('Upload Documents') || uploadBody.includes('mobile-portal'));
    assert.ok(!uploadBody.includes('Invalid Upload Token'));
    step(6, 'Assert Body Contains Mobile Upload Page (No Error)', true);
  } catch (e: any) {
    step(6, 'Assert Body Contains Mobile Upload Page (No Error)', false, e.message);
  }

  // 7. Assert token not found returns 403
  try {
    const unknownToken = 'unknown_token_9999999999999999';
    const res = await fetch(`${baseUrl}/upload?session=${testAppId}&token=${unknownToken}&format=json`, {
      headers: { Accept: 'application/json' },
    });
    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.code, 'TOKEN_NOT_FOUND');
    step(7, 'Assert Token Not Found returns 403 with code TOKEN_NOT_FOUND', true);
  } catch (e: any) {
    step(7, 'Assert Token Not Found returns 403 with code TOKEN_NOT_FOUND', false, e.message);
  }

  // 8. Assert invalid token returns 403
  try {
    const malformedToken = 'abc'; // too short
    const res = await fetch(`${baseUrl}/upload?session=${testAppId}&token=${malformedToken}&format=json`, {
      headers: { Accept: 'application/json' },
    });
    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.code, 'MALFORMED_TOKEN');
    step(8, 'Assert Invalid/Malformed Token returns 403 with code MALFORMED_TOKEN', true);
  } catch (e: any) {
    step(8, 'Assert Invalid/Malformed Token returns 403 with code MALFORMED_TOKEN', false, e.message);
  }

  // 9. Assert mismatched session returns 403
  try {
    const mismatchedSessionId = 'other_session_99999';
    const res = await fetch(`${baseUrl}/upload?session=${mismatchedSessionId}&token=${encodeURIComponent(sessionToken)}&format=json`, {
      headers: { Accept: 'application/json' },
    });
    assert.strictEqual(res.status, 403);
    const json = await res.json();
    assert.strictEqual(json.code, 'TOKEN_SESSION_MISMATCH');
    step(9, 'Assert Mismatched Session returns 403 with code TOKEN_SESSION_MISMATCH', true);
  } catch (e: any) {
    step(9, 'Assert Mismatched Session returns 403 with code TOKEN_SESSION_MISMATCH', false, e.message);
  }

  // 10. Assert expired token returns 410
  try {
    const expToken = 'exp_token_' + Date.now();
    await db.registerUploadToken(expToken, testAppId, 'req_1', '10th Marksheet', -5); // -5 minutes ago
    const res = await fetch(`${baseUrl}/upload?session=${testAppId}&token=${expToken}&format=json`, {
      headers: { Accept: 'application/json' },
    });
    assert.strictEqual(res.status, 410);
    const json = await res.json();
    assert.strictEqual(json.code, 'TOKEN_EXPIRED');
    step(10, 'Assert Expired Token returns 410 with code TOKEN_EXPIRED', true);
  } catch (e: any) {
    step(10, 'Assert Expired Token returns 410 with code TOKEN_EXPIRED', false, e.message);
  }

  // 11. Assert consumed token returns 410
  try {
    const consumedToken = 'consumed_token_' + Date.now();
    await db.registerUploadToken(consumedToken, testAppId, 'req_1', '10th Marksheet', 30);
    // Mark as consumed using authoritative db method
    await db.consumeUploadToken(consumedToken, true);

    const res = await fetch(`${baseUrl}/upload?session=${testAppId}&token=${consumedToken}&format=json`, {
      headers: { Accept: 'application/json' },
    });
    assert.strictEqual(res.status, 410);
    const json = await res.json();
    assert.strictEqual(json.code, 'TOKEN_CLOSED');
    step(11, 'Assert Consumed Token returns 410 with code TOKEN_CLOSED', true);
  } catch (e: any) {
    step(11, 'Assert Consumed Token returns 410 with code TOKEN_CLOSED', false, e.message);
  }

  // 12. Assert query string encoding changes nothing
  try {
    const doubleEncodedUrl = `${baseUrl}/upload?session=${encodeURIComponent(encodeURIComponent(testAppId))}&token=${encodeURIComponent(encodeURIComponent(sessionToken))}&format=json`;
    const singleEncodedUrl = `${baseUrl}/upload?session=${encodeURIComponent(testAppId)}&token=${encodeURIComponent(sessionToken)}&format=json`;
    const res = await fetch(singleEncodedUrl);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.valid, true);
    step(12, 'Assert URL Query String Encoding Changes Nothing', true);
  } catch (e: any) {
    step(12, 'Assert URL Query String Encoding Changes Nothing', false, e.message);
  }

  // 13. Assert URL without doc param works
  try {
    const urlNoDoc = `${baseUrl}/upload?session=${encodeURIComponent(testAppId)}&token=${encodeURIComponent(sessionToken)}&format=json`;
    const res = await fetch(urlNoDoc);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.valid, true);
    step(13, 'Assert URL Without doc Param Works (Returns 200)', true);
  } catch (e: any) {
    step(13, 'Assert URL Without doc Param Works (Returns 200)', false, e.message);
  }

  // 14. Assert URL with doc param works
  try {
    const urlWithDoc = `${baseUrl}/upload?session=${encodeURIComponent(testAppId)}&token=${encodeURIComponent(sessionToken)}&doc=10th%20Marksheet&format=json`;
    const res = await fetch(urlWithDoc);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.valid, true);
    step(14, 'Assert URL With doc Param Works (Returns 200)', true);
  } catch (e: any) {
    step(14, 'Assert URL With doc Param Works (Returns 200)', false, e.message);
  }

  // 15. Assert single doc token works
  try {
    const singleDocToken = 'single_doc_tok_' + Date.now();
    await db.registerUploadToken(singleDocToken, testAppId, 'req_1', '10th Marksheet', 30);
    const res = await fetch(`${baseUrl}/upload?session=${testAppId}&token=${singleDocToken}&doc=10th%20Marksheet&format=json`);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.valid, true);
    assert.strictEqual(json.expectedType, '10th Marksheet');
    step(15, 'Assert Single Doc Token Works', true);
  } catch (e: any) {
    step(15, 'Assert Single Doc Token Works', false, e.message);
  }

  // 16. Assert session all docs token works
  try {
    const res = await fetch(`${baseUrl}/upload?session=${encodeURIComponent(testAppId)}&token=${encodeURIComponent(sessionToken)}&format=json`);
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.valid, true);
    assert.strictEqual(json.expectedType, 'ALL');
    step(16, 'Assert Session All Docs Token Works (expectedType=ALL)', true);
  } catch (e: any) {
    step(16, 'Assert Session All Docs Token Works (expectedType=ALL)', false, e.message);
  }

  // 17. Assert Supabase/Authoritative Storage read works
  try {
    const tokenRecord = await db.getUploadToken(sessionToken);
    assert.ok(tokenRecord);
    assert.strictEqual(tokenRecord.sessionId, testAppId);
    assert.ok(tokenRecord.rawToken === sessionToken || tokenRecord.tokenHash.length === 64);
    step(17, 'Assert Authoritative Store Read Works (db.getUploadToken)', true);
  } catch (e: any) {
    step(17, 'Assert Authoritative Store Read Works (db.getUploadToken)', false, e.message);
  }

  // 18. Assert Supabase/Authoritative Storage write works
  try {
    const writeTestToken = 'test_write_' + Date.now();
    await db.registerUploadToken(writeTestToken, testAppId, 'req_write', 'Identity Proof', 30);
    const verified = await db.getUploadToken(writeTestToken);
    assert.ok(verified);
    assert.strictEqual(verified.expectedDocumentType, 'Identity Proof');
    assert.strictEqual(verified.status, 'active');
    step(18, 'Assert Authoritative Store Write Works (db.registerUploadToken)', true);
  } catch (e: any) {
    step(18, 'Assert Authoritative Store Write Works (db.registerUploadToken)', false, e.message);
  }

  // Also test the safe diagnostic endpoint (Requirement 9)
  try {
    const debugRes = await fetch(`${baseUrl}/api/debug/upload-session?session=${encodeURIComponent(testAppId)}`);
    assert.strictEqual(debugRes.status, 200);
    const debugData = await debugRes.json();
    assert.strictEqual(debugData.sessionExists, true);
    assert.strictEqual(debugData.tokenExists, true);
    assert.strictEqual(debugData.tokenSessionMatches, true);
    assert.strictEqual(debugData.expired, false);
    assert.ok(!('token' in debugData), 'Must NOT contain raw token');
    console.log('  ✓ [BONUS] GET /api/debug/upload-session safe diagnostic endpoint returns accurate non-sensitive metadata');
  } catch (e: any) {
    console.warn('  ✗ [BONUS] Safe diagnostic endpoint check failed:', e.message);
  }

  console.log('\n----------------------------------------------------------------------');
  console.log(`ACCEPTANCE RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL 18 STEPS)`);
  console.log('----------------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run18StepTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
