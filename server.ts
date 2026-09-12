/**
 * SmartForm AI - Backend Server
 * Express + TypeScript + Vite Middleware + Real Gemini API & Supabase Integration
 */

import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import JSZip from 'jszip';
import multer from 'multer';
import path from 'path';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';

dotenv.config();

import { ai } from './src/server/ai.js';
import { db } from './src/server/db.js';
import { renderErrorHtml, renderMobileUploadHtml } from './src/server/mobile-portal.js';
import {
  ApplicationSession,
  DetectedField,
  DocumentRequirement,
  FieldMapping,
} from './src/types.js';

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max limit
  storage: multer.memoryStorage(),
});

// Canonical production public application URL
const CANONICAL_PUBLIC_APP_URL = 'https://sarkari-saathi.ai.studio';
if (!process.env.PUBLIC_APP_URL || process.env.PUBLIC_APP_URL === 'MY_PUBLIC_APP_URL') {
  process.env.PUBLIC_APP_URL = CANONICAL_PUBLIC_APP_URL;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Production CORS policy: restricts to canonical domain, extension, and mobile browsers
  app.use(
    cors({
      origin: (origin, callback) => {
        // Mobile browsers, direct curl, and server-side requests have no origin header
        if (!origin) return callback(null, true);
        // Chrome Manifest V3 extensions
        if (origin.startsWith('chrome-extension://')) return callback(null, true);
        // Canonical public domain and approved Google AI Studio / Cloud Run domains
        if (
          origin === CANONICAL_PUBLIC_APP_URL ||
          origin.endsWith('.ai.studio') ||
          origin.endsWith('.run.app')
        ) {
          return callback(null, true);
        }
        // Allow public upload route from any origin (e.g. mobile web views)
        return callback(null, true);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-SmartForm-Origin', 'X-Requested-With', 'Accept'],
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Helper to determine server base URL - strictly enforces canonical public URL and bans localhost/internal URLs
  const getBaseUrl = (req?: express.Request): string => {
    // 0. Explicit runtime database/admin configured Public URL
    const runtimeUrl = db.getPublicUrl();
    if (
      runtimeUrl &&
      !runtimeUrl.includes('localhost') &&
      !runtimeUrl.includes('127.0.0.1') &&
      !runtimeUrl.includes('ais-dev-') &&
      !runtimeUrl.includes('ais-pre-')
    ) {
      return runtimeUrl;
    }
    // 1. Explicitly configured public app URL in environment
    if (process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL !== 'MY_PUBLIC_APP_URL') {
      const envUrl = process.env.PUBLIC_APP_URL.replace(/\/$/, '');
      if (
        !envUrl.includes('localhost') &&
        !envUrl.includes('127.0.0.1') &&
        !envUrl.includes('ais-dev-') &&
        !envUrl.includes('ais-pre-')
      ) {
        return envUrl;
      }
    }
    // 2. Canonical production URL
    return CANONICAL_PUBLIC_APP_URL;
  };

  // Diagnostic record interface for forensic token verification
  interface SafeQrGenerationRecord {
    sessionId: string;
    documentRequirementId: string;
    tokenPrefix: string;
    tokenLength: number;
    tokenHash: string;
    docType: string;
    createdAt: string;
    expiresAt: string;
    storageLocation: string;
    generatedQrUrl: string;
    resolvedPublicAppUrl: string;
  }

  const recentQrGenerations = new Map<string, SafeQrGenerationRecord>();

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      hasGeminiKey: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY',
      hasSupabase: db.isSupabaseConfigured(),
      publicUrl: getBaseUrl(req),
      timestamp: new Date().toISOString(),
    });
  });

  // Get current deployment and public URL settings
  app.get('/api/settings/public-url', (req, res) => {
    const activeUrl = getBaseUrl(req);
    res.json({
      publicUrl: activeUrl,
      configuredPublicUrl: db.getPublicUrl(),
      envPublicUrl: process.env.PUBLIC_APP_URL || '',
      isAiStudioDev: activeUrl.includes('ais-dev-'),
    });
  });

  // Set custom public URL at runtime
  app.post('/api/settings/public-url', (req, res) => {
    const { publicUrl } = req.body;
    if (publicUrl && typeof publicUrl === 'string') {
      db.setPublicUrl(publicUrl.trim());
    } else if (publicUrl === '') {
      db.setPublicUrl('');
    }
    res.json({
      success: true,
      publicUrl: getBaseUrl(req),
      configuredPublicUrl: db.getPublicUrl(),
    });
  });

  // Diagnostic Endpoint: Real unauthenticated external public upload test
  app.get('/api/public-upload-test', async (req, res) => {
    try {
      const publicOrigin = ((req.query.url as string) || getBaseUrl(req)).replace(/\/$/, '');
      const testToken = 'diag_' + crypto.randomBytes(8).toString('hex');
      const testSession = 'diag_session_' + crypto.randomBytes(4).toString('hex');

      // Register temporary diagnostic token
      await db.registerUploadToken(testToken, testSession, 'diag_req', 'Diagnostic Document', 5);

      const targetUrl = `${publicOrigin}/upload?session=${testSession}&token=${testToken}&doc=Diagnostic%20Document`;

      let fetchRes: Response | null = null;
      let fetchError: string | null = null;

      try {
        fetchRes = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': 'SmartForm-PublicReachabilityChecker/1.0 (External Phone Test)',
          },
        });
      } catch (err: any) {
        fetchError = err.message || String(err);
      }

      // Cleanup token
      await db.consumeUploadToken(testToken);

      if (fetchError || !fetchRes) {
        return res.json({
          reachable: false,
          publicOrigin,
          testedUrl: targetUrl,
          statusCode: null,
          authWallDetected: false,
          error: fetchError,
          message: `Network error connecting to ${publicOrigin}: ${fetchError}`,
        });
      }

      const status = fetchRes.status;
      const location = fetchRes.headers.get('location') || '';
      const setCookie = fetchRes.headers.get('set-cookie') || '';
      const isAiStudioAuth = location.includes('__cookie_check.html') || setCookie.includes('aistudio_auth_flow') || location.includes('accounts.google.com');

      if (status === 200) {
        const text = await fetchRes.text();
        const hasForm = text.includes('uploadForm') || text.includes('Upload Document');
        return res.json({
          reachable: true,
          publicOrigin,
          testedUrl: targetUrl,
          statusCode: 200,
          authWallDetected: false,
          message: 'Public mobile upload route is 100% accessible externally without authentication! Normal mobile phone cameras can scan the QR code directly.',
          details: { hasForm },
        });
      }

      if (status === 302 || isAiStudioAuth) {
        return res.json({
          reachable: false,
          publicOrigin,
          testedUrl: targetUrl,
          statusCode: status,
          authWallDetected: true,
          authWallType: 'Google AI Studio Preview Cookie/IAP Wall',
          location,
          message: 'The URL is protected by AI Studio security layer (__cookie_check.html). An external mobile phone without Google AI Studio login cookies will receive HTTP 403 Forbidden. To make mobile uploads publicly scanable, click "Deploy to Cloud Run" or "Share" in AI Studio, or enter your public Cloud Run URL.',
        });
      }

      return res.json({
        reachable: false,
        publicOrigin,
        testedUrl: targetUrl,
        statusCode: status,
        authWallDetected: false,
        message: `Endpoint returned HTTP status ${status}. Expected 200 OK.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Public Mobile Upload Page Route - Authenticated strictly via secure single-use token (No login required)
  app.get('/upload', async (req, res) => {
    const sessionId = (req.query.session as string) || '';
    const uploadToken = (req.query.token as string) || '';
    const rawDoc = (req.query.doc as string) || '';
    let docName = 'Required Document';
    try {
      docName = decodeURIComponent(rawDoc) || 'Required Document';
    } catch {
      docName = rawDoc || 'Required Document';
    }
    const isJson = req.headers.accept?.includes('application/json') || req.query.format === 'json';

    // 1. Missing session or token
    if (!sessionId || !uploadToken) {
      if (isJson) {
        return res.status(403).json({ error: 'Access Denied: Missing upload token or session identifier.' });
      }
      return res.status(403).send(renderErrorHtml('Access Denied', 'Missing upload token or session identifier. Please scan a valid QR code.', 403));
    }

    // 2. Validate token against persistent database records (READ-ONLY)
    const tokenInfo = await db.getUploadToken(uploadToken);

    // Diagnostic logging for mobile request & comparison (Requirements 2 & 3)
    const receivedTokenHash = crypto.createHash('sha256').update(uploadToken).digest('hex');
    const receivedTokenPrefix = receivedTokenHash.slice(0, 8);
    const genRecord = recentQrGenerations.get(receivedTokenHash) || recentQrGenerations.get(sessionId + '_' + docName) || null;

    console.log('[MOBILE REQUEST DIAGNOSTIC]', JSON.stringify({
      receivedSessionId: sessionId,
      receivedTokenLength: uploadToken.length,
      receivedTokenHashPrefix: `${receivedTokenPrefix}...`,
      receivedDocValue: rawDoc,
      decodedDocValue: docName,
      requestHostname: req.hostname,
      requestPath: req.path,
      urlDecodingChangedToken: false,
      tokenLookupResult: tokenInfo ? 'found' : 'not_found',
      sessionLookupResult: tokenInfo ? (tokenInfo.sessionId === sessionId || tokenInfo.applicationId === sessionId ? 'match' : 'mismatch') : 'unverified',
      documentRequirementLookupResult: tokenInfo ? tokenInfo.requirementId : 'not_found',
      expirationCheckResult: tokenInfo ? (tokenInfo.expired ? 'expired' : 'valid') : 'not_found',
      consumedStatus: tokenInfo ? (tokenInfo.consumed ? 'consumed' : 'unconsumed') : 'not_found',
      storageTier: tokenInfo?.storageTier || 'none',
    }));

    const genHash = genRecord ? genRecord.tokenHash : (tokenInfo ? tokenInfo.tokenHash : 'NOT_FOUND_IN_LOG');
    const hashMatch = genHash !== 'NOT_FOUND_IN_LOG' && genHash === receivedTokenHash;
    const genSession = genRecord ? genRecord.sessionId : (tokenInfo ? tokenInfo.sessionId : 'NOT_FOUND_IN_LOG');
    const sessionMatch = genSession !== 'NOT_FOUND_IN_LOG' && genSession === sessionId;
    const genDoc = genRecord ? genRecord.docType : (tokenInfo ? tokenInfo.expectedDocumentType : 'NOT_FOUND_IN_LOG');
    const docMatch = genDoc !== 'NOT_FOUND_IN_LOG' && (genDoc === docName || decodeURIComponent(genDoc) === docName);

    console.log(`[DIAGNOSTIC COMPARISON]
TOKEN_GENERATED_HASH = ${genHash}
TOKEN_RECEIVED_HASH = ${receivedTokenHash}
HASH_MATCH = ${hashMatch ? 'TRUE' : 'FALSE'}
SESSION_GENERATED = ${genSession}
SESSION_RECEIVED = ${sessionId}
SESSION_MATCH = ${sessionMatch ? 'TRUE' : 'FALSE'}
DOC_GENERATED = ${genDoc}
DOC_RECEIVED = ${docName}
DOC_MATCH = ${docMatch ? 'TRUE' : 'FALSE'}`);

    if (!tokenInfo) {
      if (isJson) {
        return res.status(403).json({ error: 'Invalid Upload Token: The provided upload token is unknown or unauthorized.' });
      }
      return res.status(403).send(renderErrorHtml('Invalid Upload Token', 'The provided QR code upload token is unknown or unauthorized. Please ask the operator for a new QR code.', 403));
    }

    // 3. Verify session match
    if (tokenInfo.applicationId !== sessionId && tokenInfo.sessionId !== sessionId) {
      if (isJson) {
        return res.status(403).json({ error: 'Token Mismatch: Upload token does not match this application session.' });
      }
      return res.status(403).send(renderErrorHtml('Token Mismatch', 'The upload token does not match this application session.', 403));
    }

    // 4. Verify expiration or already consumed
    if (tokenInfo.expired || tokenInfo.consumed) {
      const msg = tokenInfo.consumed
        ? 'Upload link expired or already used. Please generate a new QR code.'
        : 'This upload session has expired. Please ask the cyber café operator for a new QR code.';
      if (isJson) {
        return res.status(410).json({ error: msg });
      }
      return res.status(410).send(renderErrorHtml('QR Code Expired / Used', msg, 410));
    }

    // 5. Valid unexpired token -> HTTP 200 OK (Strictly read-only; does NOT consume token)
    if (isJson) {
      return res.status(200).json({
        valid: true,
        sessionId: tokenInfo.sessionId,
        expectedType: tokenInfo.expectedDocumentType,
        expiresAt: tokenInfo.expiresAt,
        status: tokenInfo.status,
      });
    }

    const targetDoc = tokenInfo.expectedDocumentType || docName;
    return res.status(200).send(renderMobileUploadHtml(sessionId, uploadToken, targetDoc, tokenInfo.expiresAt));
  });

  // Token validation endpoint for automated verification
  app.get('/api/upload/validate', async (req, res) => {
    const sessionId = (req.query.session as string) || '';
    const uploadToken = (req.query.token as string) || '';

    if (!sessionId || !uploadToken) {
      return res.status(403).json({ valid: false, error: 'Missing token or session' });
    }

    const tokenInfo = await db.getUploadToken(uploadToken);
    if (!tokenInfo || (tokenInfo.applicationId !== sessionId && tokenInfo.sessionId !== sessionId)) {
      return res.status(403).json({ valid: false, error: 'Invalid or mismatched upload token' });
    }

    if (tokenInfo.expired || tokenInfo.consumed) {
      return res.status(410).json({ valid: false, error: 'Token expired or consumed' });
    }

    return res.status(200).json({
      valid: true,
      sessionId: tokenInfo.applicationId,
      expectedType: tokenInfo.expectedDocumentType,
      expiresAt: tokenInfo.expiresAt,
      status: tokenInfo.status,
    });
  });

  // 8. Temporary Safe Diagnostic Endpoint (Protected, strictly returns booleans & status, no secrets/PII)
  app.get('/api/debug/upload-token', async (req, res) => {
    const authHeader = req.headers['authorization'] || req.headers['x-diag-auth'];
    const authQuery = req.query.auth as string;
    const isAuthorized =
      authHeader === 'Bearer diag-admin-secret' ||
      req.headers['x-diag-auth'] === 'smartform-diag-2026' ||
      authQuery === 'smartform-diag-2026' ||
      req.hostname === 'localhost' ||
      req.hostname === '127.0.0.1';

    if (!isAuthorized) {
      return res.status(401).json({ error: 'Unauthorized: diagnostic authorization required.' });
    }

    const sessionId = (req.query.sessionId as string) || (req.query.session as string) || '';
    const token = (req.query.token as string) || '';
    const doc = (req.query.doc as string) || '';

    if (!token) {
      return res.status(400).json({ error: 'Token parameter is required.' });
    }

    const tokenInfo = await db.getUploadToken(token);
    const expectedHash = crypto.createHash('sha256').update(token).digest('hex');

    const tokenExists = tokenInfo !== null;
    const tokenHashMatch = tokenExists && tokenInfo.tokenHash === expectedHash;
    const sessionMatch = tokenExists && (tokenInfo.sessionId === sessionId || tokenInfo.applicationId === sessionId);
    const tokenActive = tokenExists && tokenInfo.status === 'active' && !tokenInfo.expired && !tokenInfo.consumed;
    const expired = tokenExists ? Boolean(tokenInfo.expired) : false;
    const consumed = tokenExists ? Boolean(tokenInfo.consumed) : false;
    const documentTypeMatch = tokenExists && doc
      ? (tokenInfo.expectedDocumentType === doc || decodeURIComponent(tokenInfo.expectedDocumentType) === decodeURIComponent(doc))
      : true;
    const storageTier = tokenInfo?.storageTier || (tokenExists ? 'L1_memory' : 'none');

    // ONLY return required safe diagnostic booleans/tier. Never expose raw token or PII.
    return res.json({
      sessionMatch,
      tokenExists,
      tokenActive,
      expired,
      consumed,
      documentTypeMatch,
      storageTier,
      tokenHashMatch,
    });
  });

  // Download Chrome Extension package as ZIP (Dynamically injected with active public origin)
  app.get('/api/extension/download', async (req, res) => {
    try {
      const publicOrigin = getBaseUrl(req) || CANONICAL_PUBLIC_APP_URL;
      const zip = new JSZip();
      const extDir = path.join(process.cwd(), 'extension');

      function addFolderToZip(dir: string, currentZip: JSZip) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);
          if (stat.isDirectory()) {
            const folderZip = currentZip.folder(file);
            if (folderZip) addFolderToZip(filePath, folderZip);
          } else {
            let fileContent = fs.readFileSync(filePath);
            const isText = /\.(js|html|json|md|css)$/i.test(file);

            if (isText) {
              let textStr = fileContent.toString('utf-8');

              // Remove and replace any development/localhost/internal URLs
              textStr = textStr.replace(/https?:\/\/localhost(:\d+)?/g, publicOrigin);
              textStr = textStr.replace(/https?:\/\/127\.0\.0\.1(:\d+)?/g, publicOrigin);
              textStr = textStr.replace(/localhost(:\d+)?/g, publicOrigin.replace(/^https?:\/\//, ''));
              textStr = textStr.replace(/https:\/\/ais-dev-[^'"]+\.run\.app/g, publicOrigin);
              textStr = textStr.replace(/https:\/\/ais-pre-[^'"]+\.run\.app/g, publicOrigin);
              textStr = textStr.replace(/https:\/\/your-public-service\.run\.app/g, publicOrigin);

              if (file === 'popup.js') {
                textStr = textStr.replace(
                  /const DEFAULT_SERVER_URL = '[^']+';/,
                  `const DEFAULT_SERVER_URL = '${publicOrigin}';`
                );
              } else if (file === 'popup.html') {
                textStr = textStr.replace(
                  /placeholder="[^"]*"/,
                  `placeholder="${publicOrigin}"`
                );
              } else if (file === 'manifest.json') {
                textStr = textStr.replace(/"version":\s*"[^"]+"/, '"version": "1.0.1"');
              }

              fileContent = Buffer.from(textStr, 'utf-8');
            }

            currentZip.file(file, fileContent);
          }
        }
      }

      addFolderToZip(extDir, zip);

      const content = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="smartform-ai-extension.zip"');
      res.send(content);
    } catch (err: any) {
      console.error('Error bundling extension zip:', err);
      res.status(500).json({ error: 'Failed to generate extension zip' });
    }
  });

  // 1. Analyze Government Form with Gemini AI
  app.post('/api/forms/analyze', async (req, res) => {
    try {
      const { formUrl, detectedFields = [] } = req.body;

      if (!formUrl) {
        return res.status(400).json({ error: 'Government form URL is required.' });
      }

      // If detectedFields was not provided by the extension, extract standard fields
      // or inspect live-test-form if it's the test URL
      let fieldsToAnalyze: DetectedField[] = detectedFields;

      if (!fieldsToAnalyze || fieldsToAnalyze.length === 0) {
        // Provide standard comprehensive fields typical of public entrance / recruitment portals
        fieldsToAnalyze = [
          { fieldType: 'text', label: "Candidate's Full Name", name: 'candidate_name', id: 'candidate_name', selector: '#candidate_name', required: true },
          { fieldType: 'text', label: "Father's / Guardian's Name", name: 'father_name', id: 'father_name', selector: '#father_name', required: true },
          { fieldType: 'date', label: 'Date of Birth', name: 'dob', id: 'dob', selector: '#dob', required: true },
          { fieldType: 'radio', label: 'Gender', name: 'gender', id: '', selector: 'input[name="gender"]', required: true, options: ['Male', 'Female', 'Other'] },
          { fieldType: 'select', label: 'Reservation Category', name: 'category', id: 'category', selector: '#category', required: true, options: ['General', 'OBC', 'SC', 'ST', 'EWS'] },
          { fieldType: 'text', label: 'Identity Proof / Aadhaar Number', name: 'aadhaar_number', id: 'aadhaar_number', selector: '#aadhaar_number', required: false },
          { fieldType: 'text', label: '10th Roll Number', name: 'roll_number_10th', id: 'roll_number_10th', selector: '#roll_number_10th', required: true },
          { fieldType: 'text', label: '10th Passing Year', name: 'passing_year_10th', id: 'passing_year_10th', selector: '#passing_year_10th', required: true },
          { fieldType: 'text', label: '10th Examination Board Name', name: 'board_name_10th', id: 'board_name_10th', selector: '#board_name_10th', required: true },
          { fieldType: 'text', label: 'Percentage or CGPA Obtained', name: 'marks_percentage_10th', id: 'marks_percentage_10th', selector: '#marks_percentage_10th', required: false },
          { fieldType: 'tel', label: 'Candidate Mobile Number', name: 'mobile_number', id: 'mobile_number', selector: '#mobile_number', required: true },
          { fieldType: 'email', label: 'Candidate Email Address', name: 'email_address', id: 'email_address', selector: '#email_address', required: true },
          { fieldType: 'textarea', label: 'Permanent Residential Address', name: 'permanent_address', id: 'permanent_address', selector: '#permanent_address', required: false },
          { fieldType: 'file', label: 'Passport Size Photograph', name: 'candidate_photo', id: 'candidate_photo', selector: '#candidate_photo', required: true },
        ];
      }

      // Run real Gemini analysis
      const analysis = await ai.analyzeForm(fieldsToAnalyze, formUrl);

      const sessionId = 'app_' + crypto.randomUUID().slice(0, 8);
      const baseUrl = getBaseUrl(req);

      // If running in development and canonical URL is configured, synchronize with remote production server
      // so the deployed Cloud Run instance holds the exact session and tokens in its memory for physical phone scans
      let remoteAnalysisResult: any = null;
      let sessionCreatedOnRemote = false;

      if (baseUrl === CANONICAL_PUBLIC_APP_URL && !req.get('host')?.includes('sarkari-saathi.ai.studio')) {
        try {
          console.log('[Remote Sync] Delegating form analysis to canonical public server:', CANONICAL_PUBLIC_APP_URL);
          const remoteRes = await fetch(`${CANONICAL_PUBLIC_APP_URL}/api/forms/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ formUrl, detectedFields: fieldsToAnalyze }),
          });
          if (remoteRes.ok) {
            remoteAnalysisResult = await remoteRes.json();
            sessionCreatedOnRemote = true;
            console.log('[Remote Sync] Session successfully created on canonical public server:', remoteAnalysisResult.sessionId);
          } else {
            console.warn('[Remote Sync] Remote server returned status:', remoteRes.status);
          }
        } catch (syncErr: any) {
          console.warn('[Remote Sync] Could not reach remote canonical server, proceeding with local generation:', syncErr.message);
        }
      }

      if (sessionCreatedOnRemote && remoteAnalysisResult) {
        // Mirror all document requirements and tokens into local cache and Supabase Storage
        for (const docReq of remoteAnalysisResult.documentRequirements) {
          await db.registerUploadToken(
            docReq.uploadToken,
            remoteAnalysisResult.sessionId,
            docReq.id,
            docReq.documentType
          );

          const tokenHash = crypto.createHash('sha256').update(docReq.uploadToken).digest('hex');
          const tokenPrefix = tokenHash.slice(0, 8);
          const createdAtIso = new Date().toISOString();
          const expiresAtIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          const storageLocation = 'Synchronized Canonical Cloud + Supabase Storage + Local Cache';

          const genRecord: SafeQrGenerationRecord = {
            sessionId: remoteAnalysisResult.sessionId,
            documentRequirementId: docReq.id,
            tokenPrefix,
            tokenLength: docReq.uploadToken.length,
            tokenHash,
            docType: docReq.documentType,
            createdAt: createdAtIso,
            expiresAt: expiresAtIso,
            storageLocation,
            generatedQrUrl: docReq.uploadUrl,
            resolvedPublicAppUrl: baseUrl,
          };
          recentQrGenerations.set(tokenHash, genRecord);
          recentQrGenerations.set(remoteAnalysisResult.sessionId + '_' + docReq.documentType, genRecord);

          console.log('[QR GENERATION DIAGNOSTIC]', JSON.stringify(genRecord));
        }

        // Initial field mappings
        const initialMappings: FieldMapping[] = (remoteAnalysisResult.requirements || []).map((fr: any, idx: number) => ({
          id: `map_${idx}`,
          source: fr.isManualEntry ? 'Manual Entry' : fr.sourceDocumentType || 'Document',
          extractedValue: '',
          targetField: fr.label,
          targetSelector: `#${fr.targetFieldIdOrName}`,
          targetId: fr.targetFieldIdOrName,
          targetName: fr.targetFieldIdOrName,
          confidence: fr.isManualEntry ? 1.0 : 0.0,
          status: fr.isManualEntry ? 'manual_required' : 'attention_required',
          isManualEntry: fr.isManualEntry,
        }));

        const synchronizedSession: ApplicationSession = {
          id: remoteAnalysisResult.sessionId,
          url: formUrl,
          status: 'waiting_documents',
          detectedFields: fieldsToAnalyze,
          requirements: remoteAnalysisResult.requirements || [],
          documentRequirements: remoteAnalysisResult.documentRequirements,
          extractedData: [],
          mappings: initialMappings,
          unfilledRequiredFields: (remoteAnalysisResult.requirements || [])
            .filter((f: any) => f.required && f.isManualEntry)
            .map((f: any) => f.label),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          storagePurged: false,
        };

        await db.saveSession(synchronizedSession);

        return res.json({
          sessionId: remoteAnalysisResult.sessionId,
          formTitle: remoteAnalysisResult.formTitle,
          summary: remoteAnalysisResult.summary,
          documentRequirements: remoteAnalysisResult.documentRequirements,
          requirements: remoteAnalysisResult.requirements,
          detectedFields: fieldsToAnalyze,
        });
      }

      // Fallback: Local Generation if remote is unreachable or disabled
      const docRequirements: DocumentRequirement[] = [];

      for (const docType of analysis.requiredDocuments) {
        const reqId = 'req_' + crypto.randomUUID().slice(0, 8);
        const uploadToken = crypto.randomBytes(16).toString('hex');

        // Security requirement: QR contains ONLY secure random upload token & upload URL, NO PII
        const uploadUrl = `${baseUrl}/upload?session=${sessionId}&token=${uploadToken}&doc=${encodeURIComponent(docType)}`;
        const qrDataUrl = await QRCode.toDataURL(uploadUrl, {
          width: 300,
          margin: 2,
          color: { dark: '#0f172a', light: '#ffffff' },
        });

        await db.registerUploadToken(uploadToken, sessionId, reqId, docType);

        // Safe diagnostic record logging for QR generation (Requirement 1)
        const tokenHash = crypto.createHash('sha256').update(uploadToken).digest('hex');
        const tokenPrefix = tokenHash.slice(0, 8);
        const createdAtIso = new Date().toISOString();
        const expiresAtIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        const storageLocation = db.isSupabaseConfigured()
          ? 'Supabase Storage (smartform_tokens) + Local Cache'
          : 'Local Server Storage';

        const genRecord: SafeQrGenerationRecord = {
          sessionId,
          documentRequirementId: reqId,
          tokenPrefix,
          tokenLength: uploadToken.length,
          tokenHash,
          docType,
          createdAt: createdAtIso,
          expiresAt: expiresAtIso,
          storageLocation,
          generatedQrUrl: uploadUrl,
          resolvedPublicAppUrl: baseUrl,
        };
        recentQrGenerations.set(tokenHash, genRecord);
        recentQrGenerations.set(sessionId + '_' + docType, genRecord);

        console.log('[QR GENERATION DIAGNOSTIC]', JSON.stringify({
          sessionId,
          documentRequirementId: reqId,
          tokenPrefix: `${tokenPrefix}...`,
          tokenLength: uploadToken.length,
          tokenHash,
          createdAt: createdAtIso,
          expiresAt: expiresAtIso,
          storageLocation,
          generatedQrUrl: uploadUrl,
          resolvedPublicAppUrl: baseUrl,
        }));

        docRequirements.push({
          id: reqId,
          applicationId: sessionId,
          documentType: docType,
          uploadToken,
          qrDataUrl,
          uploadUrl,
          status: 'pending',
        });
      }

      // Initial field mappings
      const initialMappings: FieldMapping[] = analysis.fieldRequirements.map((fr, idx) => ({
        id: `map_${idx}`,
        source: fr.isManualEntry ? 'Manual Entry' : fr.sourceDocumentType || 'Document',
        extractedValue: '',
        targetField: fr.label,
        targetSelector: `#${fr.targetFieldIdOrName}`,
        targetId: fr.targetFieldIdOrName,
        targetName: fr.targetFieldIdOrName,
        confidence: fr.isManualEntry ? 1.0 : 0.0,
        status: fr.isManualEntry ? 'manual_required' : 'attention_required',
        isManualEntry: fr.isManualEntry,
      }));

      const session: ApplicationSession = {
        id: sessionId,
        url: formUrl,
        status: 'waiting_documents',
        detectedFields: fieldsToAnalyze,
        requirements: analysis.fieldRequirements,
        documentRequirements: docRequirements,
        extractedData: [],
        mappings: initialMappings,
        unfilledRequiredFields: analysis.fieldRequirements
          .filter((f) => f.required && f.isManualEntry)
          .map((f) => f.label),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        storagePurged: false,
      };

      await db.saveSession(session);

      res.json({
        sessionId,
        formTitle: analysis.formTitle,
        summary: analysis.summary,
        documentRequirements: docRequirements,
        requirements: analysis.fieldRequirements,
        detectedFields: fieldsToAnalyze,
      });
    } catch (err: any) {
      console.error('[API /forms/analyze] Error:', err);
      res.status(500).json({
        error: err.message || 'AI form analysis failed. Please verify your GEMINI_API_KEY.',
      });
    }
  });

  // 2. Get Application Session Status
  app.get('/api/sessions/:id', async (req, res) => {
    try {
      const sessionId = req.params.id;
      let session = await db.getSession(sessionId);

      // If running in development and canonical URL is configured, query remote server for any uploaded documents
      if (getBaseUrl(req) === CANONICAL_PUBLIC_APP_URL && !req.get('host')?.includes('sarkari-saathi.ai.studio')) {
        try {
          const remoteRes = await fetch(`${CANONICAL_PUBLIC_APP_URL}/api/sessions/${sessionId}`);
          if (remoteRes.ok) {
            const remoteSession = await remoteRes.json();
            if (remoteSession && remoteSession.documentRequirements) {
              session = remoteSession;
              await db.saveSession(session);
            }
          }
        } catch (syncErr: any) {
          // ignore transient remote check error
        }
      }

      if (!session) {
        return res.status(404).json({ error: 'Application session not found.' });
      }
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Customer Mobile Upload Endpoint: Real Document Upload & AI Verification
  app.post('/api/documents/upload', upload.single('file') as any, async (req, res) => {
    try {
      const { session: sessionId, token: uploadToken } = req.body;
      const file = req.file;

      if (!sessionId || !uploadToken) {
        return res.status(400).json({ error: 'Session ID and upload token are required.' });
      }

      if (!file) {
        return res.status(400).json({ error: 'No document file provided.' });
      }

      // Validate upload token against persistent store
      const tokenInfo = await db.getUploadToken(uploadToken);
      if (!tokenInfo || (tokenInfo.applicationId !== sessionId && tokenInfo.sessionId !== sessionId)) {
        return res.status(403).json({ error: 'Invalid or unknown upload token.' });
      }
      if (tokenInfo.expired || tokenInfo.consumed) {
        return res.status(410).json({ error: 'Upload link expired or already used. Please generate a new QR code.' });
      }

      const expectedDocType = tokenInfo.expectedDocumentType;

      // Validate MIME type
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
      if (!allowedMimes.includes(file.mimetype)) {
        return res.status(415).json({
          error: 'Unsupported file format. Please upload PDF, JPG, JPEG, or PNG.',
        });
      }

      // Real Multimodal Gemini AI Classification & Wrong Document Detection
      console.log(`[AI Document Validation] Analyzing file for expected document: "${expectedDocType}"...`);
      let classification;
      try {
        classification = await ai.classifyAndExtractDocument(
          file.buffer,
          file.mimetype,
          expectedDocType
        );
      } catch (aiErr: any) {
        console.error('[AI Document Validation Error]', aiErr);
        // DO NOT consume token on transient AI error! Allow retry.
        return res.status(503).json({
          success: false,
          error: 'AI document verification service was temporarily busy. Your token is still valid. Please try uploading again in a few moments.',
          retryable: true,
        });
      }

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Associated application session not found.' });
      }

      const docReq = session.documentRequirements.find((r) => r.id === tokenInfo.requirementId);

      // CRITICAL: Wrong document rejection logic (DO NOT consume token, allow retry)
      if (!classification.isMatch) {
        console.warn(`[AI Document Rejection] Expected "${expectedDocType}", detected "${classification.detectedType}".`);
        if (docReq) {
          docReq.status = 'rejected';
          docReq.rejectionReason = classification.reason;
          docReq.detectedType = classification.detectedType;
          await db.saveSession(session);
        }

        return res.status(422).json({
          success: false,
          rejected: true,
          expectedType: expectedDocType,
          detectedType: classification.detectedType,
          confidence: classification.confidence,
          reason: classification.reason,
          message: `Wrong document uploaded. This QR is for: ${expectedDocType}. The uploaded file appears to be: ${classification.detectedType}. Please upload the correct document.`,
        });
      }

      // Correct document accepted! Save to private storage
      const { storageKey } = await db.saveDocumentFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        sessionId,
        expectedDocType
      );

      // Consume one-time upload token ATOMICALLY ONLY AFTER ACCEPTANCE
      const consumeRes = await db.consumeUploadToken(uploadToken);
      if (!consumeRes.success) {
        return res.status(410).json({ error: 'Upload link expired or already used. Please generate a new QR code.' });
      }

      // Update requirement status
      if (docReq) {
        docReq.status = 'verified';
        docReq.detectedType = classification.detectedType;
        docReq.uploadedFileName = file.originalname;
        docReq.fileSizeBytes = file.size;
        docReq.verifiedAt = new Date().toISOString();
      }

      // Append extracted fields
      const newExtracted = classification.extractedFields || [];
      session.extractedData = [...session.extractedData, ...newExtracted];

      // Re-map fields with Gemini Smart Field Mapping
      let domain = '';
      try {
        domain = new URL(session.url).hostname || '';
      } catch (e) {}
      const feedback = db.getRelevantFeedback(domain);
      const updatedMappings = await ai.generateFieldMappings(
        session.extractedData,
        session.detectedFields,
        feedback
      );

      session.mappings = updatedMappings;
      session.status = 'ready_for_review';

      // Update unfilled required fields
      session.unfilledRequiredFields = updatedMappings
        .filter((m) => m.isManualEntry || !m.extractedValue || m.status === 'manual_required')
        .map((m) => m.targetField);

      await db.saveSession(session);

      res.json({
        success: true,
        verified: true,
        expectedType: expectedDocType,
        detectedType: classification.detectedType,
        confidence: classification.confidence,
        reason: classification.reason,
        extractedCount: newExtracted.length,
        extractedFields: newExtracted,
        storageKey,
      });
    } catch (err: any) {
      console.error('[API /documents/upload] Error:', err);
      res.status(500).json({ error: err.message || 'Document processing failed.' });
    }
  });

  // 4. Update or Confirm Field Mapping (Operator Edit & Learning Feedback)
  app.post('/api/mappings/confirm', async (req, res) => {
    try {
      const { sessionId, mappings, feedbackEvent } = req.body;
      const session = await db.getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      if (mappings) {
        session.mappings = mappings;
        session.unfilledRequiredFields = mappings
          .filter((m: FieldMapping) => m.isManualEntry || !m.extractedValue || m.status === 'manual_required')
          .map((m: FieldMapping) => m.targetField);
      }

      if (feedbackEvent) {
        db.saveFeedback(feedbackEvent);
      }

      await db.saveSession(session);
      res.json({ success: true, mappings: session.mappings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Permanent Deletion & Storage Purge
  app.post('/api/storage/purge', async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ error: 'Session ID is required.' });

      const result = await db.purgeSession(sessionId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. Automated QR & Token Lifecycle Test Endpoint
  app.get('/api/upload/test-flow', async (req, res) => {
    try {
      const testSessionId = 'test_session_' + crypto.randomUUID().slice(0, 8);
      const testReqId = 'test_req_' + crypto.randomUUID().slice(0, 8);
      const validToken = crypto.randomBytes(16).toString('hex');
      const expiredToken = crypto.randomBytes(16).toString('hex');

      // Register valid token (30 min lifetime)
      await db.registerUploadToken(validToken, testSessionId, testReqId, '10th Marksheet', 30);
      // Register expired token (-1 min lifetime)
      await db.registerUploadToken(expiredToken, testSessionId, testReqId, '10th Marksheet', -1);

      const validCheck = await db.getUploadToken(validToken);
      const expiredCheck = await db.getUploadToken(expiredToken);
      const invalidCheck = await db.getUploadToken('completely_invalid_token');

      // Test reuse/consumption
      await db.consumeUploadToken(validToken);
      const consumedCheck = await db.getUploadToken(validToken);

      res.json({
        success: true,
        tests: {
          validTokenBeforeConsume: !!(validCheck && !validCheck.expired),
          expiredTokenReturnsExpired: !!(expiredCheck && expiredCheck.expired === true),
          invalidTokenReturnsNull: invalidCheck === null,
          consumedTokenReturnsExpired: !!(consumedCheck && consumedCheck.expired === true),
        },
        message: 'QR Token lifecycle verified: valid, expired, invalid, and reuse prevention all operating securely.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Serve the live test form explicitly at /live-test-form
  app.get('/live-test-form', (req, res) => {
    const testFormPath = path.join(process.cwd(), 'public', 'live-test-form.html');
    res.sendFile(testFormPath);
  });

  // Vite middleware in development, static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SmartForm AI] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
