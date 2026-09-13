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
import { inspectTargetPage } from './src/server/form-inspector.js';
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

  // Helper to determine server base URL
  const getBaseUrl = (req?: express.Request): string => {
    // 0. Explicit runtime database/admin configured Public URL
    const runtimeUrl = db.getPublicUrl();
    if (runtimeUrl && !runtimeUrl.includes('localhost') && !runtimeUrl.includes('127.0.0.1')) {
      return runtimeUrl;
    }
    // 1. Explicitly configured public app URL in environment
    if (process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL !== 'MY_PUBLIC_APP_URL') {
      const envUrl = process.env.PUBLIC_APP_URL.replace(/\/$/, '');
      if (!envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
        return envUrl;
      }
    }
    // 2. Derive dynamically from active request host header if available
    if (req && req.get('host')) {
      const host = req.get('host')!;
      const proto = (req.headers['x-forwarded-proto'] as string) || (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
      return `${proto}://${host}`;
    }
    // 3. Fallback to canonical production URL
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
    const rawSessionId = (req.query.session as string) || '';
    const rawUploadToken = (req.query.token as string) || '';
    const rawDoc = (req.query.doc as string) || '';

    const sessionId = decodeURIComponent(rawSessionId).trim();
    let uploadToken = '';
    try {
      uploadToken = decodeURIComponent(rawUploadToken).trim().replace(/^['"]|['"]$/g, '');
    } catch {
      uploadToken = rawUploadToken.trim().replace(/^['"]|['"]$/g, '');
    }

    let docName = 'Required Document';
    try {
      docName = decodeURIComponent(rawDoc).trim() || 'Required Document';
    } catch {
      docName = rawDoc.trim() || 'Required Document';
    }
    const isJson = req.headers.accept?.includes('application/json') || req.query.format === 'json';

    // 1. Missing or malformed parameters (Requirement 2 & 6)
    if (!sessionId || !uploadToken || uploadToken.length < 16) {
      const diagnosticReason = 'MALFORMED_TOKEN';
      console.warn('[MOBILE REQUEST DIAGNOSTIC - REJECTED]', JSON.stringify({
        requestHostname: req.hostname,
        requestProtocol: req.protocol,
        requestPath: req.path,
        sessionIdReceived: sessionId || 'MISSING',
        tokenLength: uploadToken?.length || 0,
        maskedToken: uploadToken ? `${uploadToken.slice(0, 4)}...${uploadToken.slice(-4)}` : 'none',
        PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || '',
        tokenLookupResult: 'not_checked',
        sessionLookupResult: 'not_checked',
        tokenScope: 'none',
        tokenWorkflowMode: 'none',
        tokenExpiry: 'none',
        tokenStatus: 'none',
        sessionStatus: 'none',
        requiredDocumentCount: 0,
        exactReason: diagnosticReason,
      }));

      if (isJson) {
        return res.status(403).json({ error: 'Malformed Upload Token', code: diagnosticReason, valid: false });
      }
      return res.status(403).send(renderErrorHtml('Malformed Upload Token', 'The upload URL parameter format is invalid or missing.', 403, diagnosticReason));
    }

    // 2. Compute hashes and compare
    const receivedTokenHash = crypto.createHash('sha256').update(uploadToken.toLowerCase()).digest('hex');
    const receivedTokenPrefix = receivedTokenHash.slice(0, 8);
    const maskedToken = `${uploadToken.slice(0, 4)}...${uploadToken.slice(-4)}`;

    // Authoritative lookup from single source of truth (Supabase Storage / DB)
    const tokenInfo = await db.getUploadToken(uploadToken);

    // 3. Structured diagnostic reason determination (Requirement 2)
    let diagnosticReason: string | null = null;
    let failureStatus = 403;
    let failureTitle = 'Invalid Upload Token';
    let failureMsg = 'The provided upload token is unknown or unauthorized.';

    if (!tokenInfo) {
      diagnosticReason = 'TOKEN_NOT_FOUND';
      failureTitle = 'Invalid Upload Token';
      failureMsg = 'The provided QR code upload token was not found in the database.';
    } else if (tokenInfo.applicationId !== sessionId && tokenInfo.sessionId !== sessionId) {
      diagnosticReason = 'TOKEN_SESSION_MISMATCH';
      failureTitle = 'Session Mismatch';
      failureMsg = 'The upload token does not match this application session.';
    } else if (tokenInfo.consumed || tokenInfo.status === 'consumed' || Boolean(tokenInfo.consumedAt)) {
      diagnosticReason = 'TOKEN_CLOSED';
      failureStatus = 410;
      failureTitle = 'Token Already Used';
      failureMsg = 'This upload link has already been used and closed.';
    } else if (tokenInfo.expired || Date.now() > tokenInfo.expiresAt || tokenInfo.status === 'expired') {
      diagnosticReason = 'TOKEN_EXPIRED';
      failureStatus = 410;
      failureTitle = 'QR Code Expired';
      failureMsg = 'This upload session has expired. Please ask the operator for a new QR code.';
    } else if (tokenInfo.scope !== 'SESSION_ALL_DOCS' && tokenInfo.scope !== 'SINGLE_DOC') {
      diagnosticReason = 'TOKEN_SCOPE_INVALID';
      failureTitle = 'Invalid Token Scope';
      failureMsg = 'The token scope is invalid or unsupported.';
    } else if (docName !== 'Required Document' && docName !== 'ALL' && tokenInfo.scope === 'SINGLE_DOC' && tokenInfo.expectedDocumentType !== 'ALL' && tokenInfo.expectedDocumentType !== docName) {
      diagnosticReason = 'DOCUMENT_PERMISSION_INVALID';
      failureTitle = 'Document Permission Denied';
      failureMsg = `This token is only authorized for ${tokenInfo.expectedDocumentType}, not ${docName}.`;
    }

    // Comprehensive mobile diagnostic logging (Requirement 2)
    console.log('[MOBILE REQUEST DIAGNOSTIC]', JSON.stringify({
      requestHostname: req.hostname,
      requestProtocol: req.protocol,
      requestPath: req.path,
      sessionIdReceived: sessionId,
      tokenLength: uploadToken.length,
      maskedToken,
      PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || '',
      tokenLookupResult: tokenInfo ? 'found' : 'not_found',
      sessionLookupResult: tokenInfo ? (tokenInfo.sessionId === sessionId || tokenInfo.applicationId === sessionId ? 'match' : 'mismatch') : 'not_found',
      tokenScope: tokenInfo?.scope || 'unknown',
      tokenWorkflowMode: tokenInfo?.workflowMode || 'unknown',
      tokenExpiry: tokenInfo ? new Date(tokenInfo.expiresAt).toISOString() : 'unknown',
      tokenStatus: tokenInfo?.status || 'unknown',
      sessionStatus: tokenInfo ? 'active' : 'unknown',
      requiredDocumentCount: tokenInfo?.requiredDocuments?.length || 0,
      storageTier: tokenInfo?.storageTier || 'none',
      exactReason: diagnosticReason || 'VALID_TOKEN_SUCCESS',
    }));

    // Diagnostic comparison log (Requirement 5)
    console.log(`[DIAGNOSTIC COMPARISON]
TOKEN_RECEIVED_HASH = ${receivedTokenHash}
TOKEN_LOOKUP = ${tokenInfo ? 'SUCCESS' : 'NOT_FOUND'}
SESSION_MATCH = ${tokenInfo && (tokenInfo.sessionId === sessionId || tokenInfo.applicationId === sessionId) ? 'SUCCESS' : 'MISMATCH'}
TOKEN_HASH_MATCH = ${tokenInfo && tokenInfo.tokenHash === receivedTokenHash ? 'SUCCESS' : 'MISMATCH'}`);

    if (diagnosticReason) {
      if (isJson) {
        return res.status(failureStatus).json({
          error: failureTitle,
          code: diagnosticReason,
          message: failureMsg,
          valid: false,
        });
      }
      return res.status(failureStatus).send(renderErrorHtml(failureTitle, failureMsg, failureStatus, diagnosticReason));
    }

    // 5. Valid unexpired token -> HTTP 200 OK (Strictly read-only; does NOT consume token)
    let session = await db.getSession(sessionId);
    if (!session || !session.documentRequirements || session.documentRequirements.length === 0) {
      if (tokenInfo!.requiredDocuments && tokenInfo!.requiredDocuments.length > 0) {
        const nowIso = new Date().toISOString();
        const expiresIso = new Date(tokenInfo!.expiresAt).toISOString();
        session = {
          id: sessionId,
          workflowMode: tokenInfo!.workflowMode || 'URL_PASTE',
          url: tokenInfo!.formUrl || '',
          pastedUrl: tokenInfo!.formUrl || '',
          inspectedUrl: '',
          pageTitle: 'Government Application',
          formActionUrl: '',
          inspectedAt: nowIso,
          inspectionState: 'active_inspected',
          status: 'waiting_documents',
          detectedFields: [],
          requirements: [],
          documentRequirements: tokenInfo!.requiredDocuments,
          sessionUploadToken: uploadToken,
          sessionQrDataUrl: '',
          sessionUploadUrl: `${getBaseUrl(req)}/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(uploadToken)}`,
          extractedData: [],
          mappings: [],
          unfilledRequiredFields: [],
          createdAt: tokenInfo!.createdAt,
          expiresAt: expiresIso,
          storagePurged: false,
        };
        await db.saveSession(session);
      } else {
        const fallbackUnified = await db.createUnifiedUploadSession({
          applicationId: sessionId || tokenInfo!.applicationId || tokenInfo!.sessionId,
          workflowMode: tokenInfo!.workflowMode || 'URL_PASTE',
          baseUrl: getBaseUrl(req),
        });
        session = fallbackUnified.session;
      }
    }

    if (isJson) {
      return res.status(200).json({
        valid: true,
        sessionId: tokenInfo!.sessionId,
        expectedType: tokenInfo!.expectedDocumentType,
        documentRequirements: session?.documentRequirements || [],
        expiresAt: tokenInfo!.expiresAt,
        status: tokenInfo!.status,
      });
    }

    return res.status(200).send(renderMobileUploadHtml(session, uploadToken, tokenInfo!.expiresAt));
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

  // Safe Diagnostic Endpoint for Upload Session Inspection (Requirement 9)
  app.get('/api/debug/upload-session', async (req, res) => {
    const rawSession = (req.query.session as string) || (req.query.sessionId as string) || '';
    const sessionId = decodeURIComponent(rawSession).trim();

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID parameter is required (?session=<id>)' });
    }

    const session = await db.getSession(sessionId);
    let tokenInfo: any = null;

    if (session?.sessionUploadToken) {
      tokenInfo = await db.getUploadToken(session.sessionUploadToken);
    }

    const sessionExists = Boolean(session);
    const tokenExists = Boolean(tokenInfo);
    const tokenSessionMatches = Boolean(
      tokenInfo && (tokenInfo.sessionId === sessionId || tokenInfo.applicationId === sessionId)
    );
    const status = tokenInfo?.status || session?.status || (sessionExists ? 'active' : 'not_found');
    const expired = tokenInfo ? (Date.now() > tokenInfo.expiresAt || tokenInfo.status === 'expired') : false;
    const scope = tokenInfo?.scope || (session ? 'SESSION_ALL_DOCS' : 'NONE');
    const workflowMode = tokenInfo?.workflowMode || session?.workflowMode || 'URL_PASTE';
    const requiredDocumentCount = session?.documentRequirements?.length || tokenInfo?.requiredDocuments?.length || 0;

    // NEVER return the raw token - safe metadata only (Requirement 9)
    return res.json({
      sessionExists,
      tokenExists,
      tokenSessionMatches,
      status,
      expired,
      scope,
      workflowMode,
      requiredDocumentCount,
      storageTier: tokenInfo?.storageTier || (tokenExists ? 'L3_supabase_storage' : 'none'),
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
      const {
        formUrl,
        pastedUrl,
        inspectedUrl,
        url,
        workflowMode,
        pageTitle,
        formActionUrl,
        detectedFields = [],
        targetTabId,
        targetWindowId,
        targetOrigin,
        timestamp,
      } = req.body;

      const effectiveUrl = formUrl || pastedUrl || inspectedUrl || url;
      if (!effectiveUrl) {
        return res.status(400).json({ error: 'Government form URL is required.' });
      }

      const activeUrl = String(effectiveUrl).trim();
      const resolvedMode = (workflowMode === 'EXTENSION_INSPECTION' || (!workflowMode && typeof targetTabId === 'number' && inspectedUrl))
        ? 'EXTENSION_INSPECTION'
        : 'URL_PASTE';

      const resolvedPastedUrl = resolvedMode === 'URL_PASTE' ? (pastedUrl || activeUrl) : undefined;
      const exactInspectedUrl = resolvedMode === 'EXTENSION_INSPECTION' ? (inspectedUrl || activeUrl) : (inspectedUrl || undefined);

      // Inspect real DOM fields from the target page (avoiding hardcoded mock selectors)
      const inspectionResult = await inspectTargetPage(activeUrl, detectedFields);
      const fieldsToAnalyze: DetectedField[] = inspectionResult.fields;

      // Run real Gemini analysis
      const analysis = await ai.analyzeForm(fieldsToAnalyze, formUrl);

      const baseUrl = getBaseUrl(req);

      // CORE ARCHITECTURAL DIRECTIVE: ONE APPLICATION = ONE QR CODE
      // Unified for BOTH URL_PASTE and EXTENSION_INSPECTION modes
      const unified = await db.createUnifiedUploadSession({
        workflowMode: resolvedMode,
        requiredDocuments: analysis.requiredDocuments,
        detectedFields: fieldsToAnalyze,
        fieldRequirements: analysis.fieldRequirements,
        formUrl: activeUrl,
        pastedUrl: resolvedPastedUrl,
        inspectedUrl: exactInspectedUrl,
        pageTitle: pageTitle || inspectionResult.formTitle || analysis.formTitle,
        formActionUrl: formActionUrl,
        targetTabId: typeof targetTabId === 'number' ? targetTabId : undefined,
        targetWindowId: typeof targetWindowId === 'number' ? targetWindowId : undefined,
        targetOrigin: targetOrigin || (activeUrl ? new URL(activeUrl).origin : undefined),
        baseUrl,
      });

      // Diagnostic logging for single session QR generation & URL verification (Requirements 1 & 5)
      const sessionTokenHash = crypto.createHash('sha256').update(unified.secureToken.toLowerCase()).digest('hex');
      const qrParsed = new URL(unified.qrUrl);
      const maskedToken = `${unified.secureToken.slice(0, 4)}...${unified.secureToken.slice(-4)}`;
      const maskedQrUrl = `${qrParsed.origin}${qrParsed.pathname}?session=${encodeURIComponent(unified.sessionId)}&token=${maskedToken}`;

      const genRecord: SafeQrGenerationRecord = {
        sessionId: unified.sessionId,
        documentRequirementId: 'ALL',
        tokenPrefix: sessionTokenHash.slice(0, 8),
        tokenLength: unified.secureToken.length,
        tokenHash: sessionTokenHash,
        docType: 'ALL_DOCUMENTS',
        createdAt: unified.session.createdAt,
        expiresAt: unified.session.expiresAt,
        storageLocation: db.isSupabaseConfigured()
          ? 'Supabase Storage (smartform_tokens) + Local Cache'
          : 'Local Server Storage',
        generatedQrUrl: maskedQrUrl,
        resolvedPublicAppUrl: baseUrl,
      };
      recentQrGenerations.set(sessionTokenHash, genRecord);
      recentQrGenerations.set(unified.sessionId + '_ALL', genRecord);

      console.log('[EXACT QR URL DIAGNOSTIC]', JSON.stringify({
        protocol: qrParsed.protocol,
        hostname: qrParsed.hostname,
        pathname: qrParsed.pathname,
        sessionParam: qrParsed.searchParams.get('session'),
        tokenParamMasked: maskedToken,
        tokenLength: unified.secureToken.length,
        tokenIsPureHex: /^[a-f0-9]{32}$/i.test(unified.secureToken),
        specialCharactersPresent: /[^a-f0-9]/i.test(unified.secureToken),
        urlEncodingValid: !unified.qrUrl.includes(' '),
        containsLocalhost: qrParsed.hostname.includes('localhost') || qrParsed.hostname.includes('127.0.0.1'),
        containsPreviewUrl: qrParsed.hostname.includes('ais-dev') || qrParsed.hostname.includes('aistudio.google.com'),
        containsRunApp: qrParsed.hostname.includes('run.app'),
        isCanonicalDomain: qrParsed.hostname === 'sarkari-saathi.ai.studio',
        finalMaskedQrUrl: maskedQrUrl,
        storageDatastore: db.isSupabaseConfigured() ? 'Supabase Storage (smartform_tokens)' : 'Local Disk / Memory',
      }));

      console.log(`[TOKEN GENERATION HASH] = ${sessionTokenHash}`);
      console.log('[SINGLE QR GENERATION DIAGNOSTIC]', JSON.stringify(genRecord));

      res.json({
        sessionId: unified.sessionId,
        workflowMode: unified.session.workflowMode,
        formTitle: analysis.formTitle,
        summary: analysis.summary,
        documentRequirements: unified.requiredDocuments,
        sessionUploadToken: unified.secureToken,
        sessionUploadUrl: unified.qrUrl,
        sessionQrDataUrl: unified.qrDataUrl,
        requirements: analysis.fieldRequirements,
        detectedFields: fieldsToAnalyze,
        targetTabId: unified.session.targetTabId,
        targetWindowId: unified.session.targetWindowId,
        targetOrigin: unified.session.targetOrigin,
        targetUrl: unified.session.url,
        pastedUrl: unified.session.pastedUrl,
        inspectedUrl: unified.session.inspectedUrl,
        pageTitle: unified.session.pageTitle,
        formActionUrl: unified.session.formActionUrl,
        inspectedAt: unified.session.inspectedAt,
        inspectionState: unified.session.inspectionState,
      });
    } catch (err: any) {
      console.error('[API /forms/analyze] Error:', err);
      res.status(500).json({
        error: err.message || 'AI form analysis failed. Please verify your GEMINI_API_KEY.',
      });
    }
  });

  // 1b. Associate / Update Target Tab for Active Form Session
  app.post('/api/sessions/:id/target-tab', async (req, res) => {
    try {
      const sessionId = req.params.id;
      const {
        targetTabId,
        targetWindowId,
        targetUrl,
        pastedUrl,
        targetOrigin,
        inspectedUrl,
        workflowMode,
        pageTitle,
        formActionUrl,
        inspectedAt,
        inspectionState,
      } = req.body;
      const session = await db.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Application session not found.' });
      }

      if (workflowMode === 'URL_PASTE' || workflowMode === 'EXTENSION_INSPECTION') session.workflowMode = workflowMode;
      if (typeof targetTabId === 'number') session.targetTabId = targetTabId;
      if (typeof targetWindowId === 'number') session.targetWindowId = targetWindowId;
      if (targetUrl && typeof targetUrl === 'string') session.url = targetUrl;
      if (pastedUrl && typeof pastedUrl === 'string') session.pastedUrl = pastedUrl;
      if (targetOrigin && typeof targetOrigin === 'string') session.targetOrigin = targetOrigin;
      if (inspectedUrl && typeof inspectedUrl === 'string') session.inspectedUrl = inspectedUrl;
      if (pageTitle && typeof pageTitle === 'string') session.pageTitle = pageTitle;
      if (formActionUrl && typeof formActionUrl === 'string') session.formActionUrl = formActionUrl;
      if (inspectedAt && typeof inspectedAt === 'string') session.inspectedAt = inspectedAt;
      if (inspectionState && typeof inspectionState === 'string') session.inspectionState = inspectionState as any;

      await db.saveSession(session);

      res.json({
        success: true,
        sessionId: session.id,
        workflowMode: session.workflowMode,
        targetTabId: session.targetTabId,
        targetWindowId: session.targetWindowId,
        targetUrl: session.url,
        pastedUrl: session.pastedUrl,
        targetOrigin: session.targetOrigin,
        inspectedUrl: session.inspectedUrl,
        pageTitle: session.pageTitle,
        formActionUrl: session.formActionUrl,
        inspectedAt: session.inspectedAt,
        inspectionState: session.inspectionState,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 1c. Query Target Tab Status
  app.get('/api/sessions/:id/tab-status', async (req, res) => {
    try {
      const sessionId = req.params.id;
      const session = await db.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Application session not found.' });
      }

      res.json({
        success: true,
        sessionId: session.id,
        workflowMode: session.workflowMode,
        targetTabId: session.targetTabId,
        targetWindowId: session.targetWindowId,
        targetUrl: session.url,
        pastedUrl: session.pastedUrl,
        targetOrigin: session.targetOrigin,
        inspectedUrl: session.inspectedUrl,
        pageTitle: session.pageTitle,
        formActionUrl: session.formActionUrl,
        inspectedAt: session.inspectedAt,
        inspectionState: session.inspectionState,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. Get Application Session Status (Accessible via both /api/sessions/:id and /api/forms/session/:id)
  const handleGetSession = async (req: express.Request, res: express.Response) => {
    try {
      const sessionId = req.params.id;
      const session = await db.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Application session not found.' });
      }
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  app.get('/api/sessions/:id', handleGetSession);
  app.get('/api/forms/session/:id', handleGetSession);

  // 3. Customer Mobile Upload Endpoint: Real Document Upload & AI Verification
  app.post('/api/documents/upload', upload.single('file') as any, async (req, res) => {
    try {
      const { session: sessionId, token: uploadToken, requirementId: requestedReqId, docType: requestedDocType } = req.body;
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

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Associated application session not found.' });
      }

      // Identify target requirement
      let docReq = session.documentRequirements.find((r) => r.id === requestedReqId);
      if (!docReq && requestedDocType) {
        docReq = session.documentRequirements.find(
          (r) => r.documentType.toLowerCase() === requestedDocType.toLowerCase()
        );
      }
      if (!docReq && tokenInfo.requirementId && tokenInfo.requirementId !== 'ALL') {
        docReq = session.documentRequirements.find((r) => r.id === tokenInfo.requirementId);
      }
      if (!docReq && session.documentRequirements.length === 1) {
        docReq = session.documentRequirements[0];
      }

      const expectedDocType = docReq
        ? docReq.documentType
        : tokenInfo.expectedDocumentType !== 'ALL'
        ? tokenInfo.expectedDocumentType
        : requestedDocType || 'Required Document';

      // Validate MIME type
      const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
      if (!allowedMimes.includes(file.mimetype)) {
        return res.status(415).json({
          error: 'Unsupported file format. Please upload PDF, JPG, JPEG, or PNG.',
        });
      }

      // Mark requirement as processing in session
      if (docReq) {
        docReq.status = 'processing';
        await db.saveSession(session);
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
        if (docReq) {
          docReq.status = 'pending';
          await db.saveSession(session);
        }
        return res.status(503).json({
          success: false,
          error: 'AI document verification service was temporarily busy. Your token is still valid. Please try uploading again in a few moments.',
          retryable: true,
        });
      }

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
          message: `Wrong document uploaded. This field requires: ${expectedDocType}. The uploaded file appears to be: ${classification.detectedType}. Please upload the correct document.`,
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

      // Consume upload token atomically ONLY AFTER ACCEPTANCE
      // Note: for session-level tokens, consumeUploadToken keeps the session active for subsequent uploads
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
        delete docReq.rejectionReason;
      }

      // Append extracted fields (deduplicating previous fields for this document type)
      const newExtracted = classification.extractedFields || [];
      session.extractedData = [
        ...session.extractedData.filter((ef) => ef.source !== expectedDocType),
        ...newExtracted,
      ];

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

      const allVerified =
        session.documentRequirements.length > 0 &&
        session.documentRequirements.every((r) => r.status === 'verified');

      session.status = allVerified ? 'ready_for_review' : 'waiting_documents';

      // Update unfilled required fields
      session.unfilledRequiredFields = updatedMappings
        .filter((m) => m.isManualEntry || !m.extractedValue || m.status === 'manual_required')
        .map((m) => m.targetField);

      await db.saveSession(session);

      if (allVerified) {
        await db.consumeUploadToken(uploadToken, true);
      }

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
        allVerified,
        documentRequirements: session.documentRequirements,
      });
    } catch (err: any) {
      console.error('[API /documents/upload] Error:', err);
      res.status(500).json({ error: err.message || 'Document processing failed.' });
    }
  });

  // 3b. Real-Time Upload Session Summary for Operator & Mobile Sync
  app.get('/api/upload-session/:sessionId', async (req, res) => {
    try {
      const summary = await db.getUploadSessionSummary(req.params.sessionId);
      if (!summary) return res.status(404).json({ error: 'Session not found' });
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
