import JSZip from 'jszip';
import fs from 'fs';
import path from 'path';

async function verifyExtensionZip() {
  console.log('=== TASK 3: VERIFYING EXACT DOWNLOADABLE EXTENSION ZIP ARTIFACT ===\n');

  const res = await fetch('http://localhost:3000/api/extension/download');
  if (!res.ok) {
    throw new Error(`Failed to download extension ZIP from /api/extension/download: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const zipBuffer = Buffer.from(arrayBuffer);
  console.log(`[PASS] Successfully downloaded ZIP from /api/extension/download (${zipBuffer.length} bytes)`);

  const zip = await JSZip.loadAsync(zipBuffer);
  const files = Object.keys(zip.files);
  console.log(`[INFO] ZIP contains ${files.length} entries:`);
  files.forEach((f) => console.log(`   - ${f}`));

  const forbiddenMatches: { file: string; pattern: string; snippet: string }[] = [];
  let popupJsContent = '';
  let popupHtmlContent = '';
  let manifestContent = '';

  for (const filename of files) {
    const fileEntry = zip.files[filename];
    if (fileEntry.dir) continue;

    const contentStr = await fileEntry.async('text');

    if (filename.endsWith('popup.js')) popupJsContent = contentStr;
    if (filename.endsWith('popup.html')) popupHtmlContent = contentStr;
    if (filename.endsWith('manifest.json')) manifestContent = contentStr;

    // Check for forbidden strings
    const forbiddenPatterns = [
      'localhost:3000',
      'http://localhost',
      'https://localhost',
      '127.0.0.1',
    ];

    for (const pattern of forbiddenPatterns) {
      if (contentStr.includes(pattern)) {
        const idx = contentStr.indexOf(pattern);
        const snippet = contentStr.substring(Math.max(0, idx - 40), Math.min(contentStr.length, idx + 60));
        forbiddenMatches.push({ file: filename, pattern, snippet });
      }
    }
  }

  console.log('\n--- FORBIDDEN STRINGS SCAN RESULTS ---');
  if (forbiddenMatches.length === 0) {
    console.log('[PASS] ZERO occurrences of localhost:3000, http://localhost, or 127.0.0.1 found in the downloadable ZIP!');
  } else {
    console.error(`[FAIL] Found ${forbiddenMatches.length} forbidden occurrences:`);
    forbiddenMatches.forEach((m) => {
      console.error(`   File: ${m.file} | Pattern: ${m.pattern}`);
      console.error(`   Snippet: ...${m.snippet.replace(/\n/g, ' ')}...`);
    });
    process.exit(1);
  }

  console.log('\n--- EXTENSION RUNTIME CONFIGURATION CHECK ---');
  // Verify popup.js DEFAULT_SERVER_URL
  const defaultUrlMatch = popupJsContent.match(/const DEFAULT_SERVER_URL = '([^']+)';/);
  if (defaultUrlMatch) {
    console.log(`[PASS] popup.js DEFAULT_SERVER_URL is set to: "${defaultUrlMatch[1]}"`);
    if (defaultUrlMatch[1].includes('localhost')) {
      console.error('[FAIL] popup.js DEFAULT_SERVER_URL contains localhost!');
      process.exit(1);
    }
  } else {
    console.error('[FAIL] Could not find DEFAULT_SERVER_URL declaration in popup.js');
    process.exit(1);
  }

  // Verify popup.js sanitizeServerUrl exists
  if (popupJsContent.includes('sanitizeServerUrl') && popupJsContent.includes('isLocalAddress')) {
    console.log('[PASS] popup.js includes sanitizeServerUrl and isLocalAddress to purge any legacy localhost URLs from chrome.storage.local');
  } else {
    console.error('[FAIL] popup.js is missing sanitizeServerUrl protection');
    process.exit(1);
  }

  // Verify popup.html placeholder
  const placeholderMatch = popupHtmlContent.match(/placeholder="([^"]*)"/);
  if (placeholderMatch) {
    console.log(`[PASS] popup.html placeholder is set to: "${placeholderMatch[1]}"`);
  }

  // Verify manifest.json
  const manifestObj = JSON.parse(manifestContent);
  console.log(`[PASS] manifest.json version: ${manifestObj.version}, name: ${manifestObj.name}`);

  console.log('\n=== ALL EXTENSION ARTIFACT VALIDATIONS PASSED ===');
}

verifyExtensionZip().catch((err) => {
  console.error('Fatal error during extension verification:', err);
  process.exit(1);
});
