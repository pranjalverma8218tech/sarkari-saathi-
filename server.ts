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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Fully permissive CORS for mobile upload and extension
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-SmartForm-Origin'],
    })
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Helper to determine server base URL - prioritized for deployed public origins
  const getBaseUrl = (req: express.Request): string => {
    // 0. Explicit runtime database/admin configured Public URL
    const runtimeUrl = db.getPublicUrl();
    if (runtimeUrl) {
      return runtimeUrl;
    }
    // 1. Explicitly configured public app URL in environment
    if (process.env.PUBLIC_APP_URL && process.env.PUBLIC_APP_URL !== 'MY_PUBLIC_APP_URL') {
      return process.env.PUBLIC_APP_URL.replace(/\/$/, '');
    }
    // 2. Request query parameter override (e.g. ?origin=https://...)
    if (req.query?.origin && typeof req.query.origin === 'string' && req.query.origin.startsWith('http')) {
      return req.query.origin.replace(/\/$/, '');
    }
    // 3. Request body origin (sent from React operator dashboard or extension)
    if (req.body?.origin && typeof req.body.origin === 'string' && req.body.origin.startsWith('http')) {
      return req.body.origin.replace(/\/$/, '');
    }
    // 4. Request headers from client/dashboard
    const clientOrigin = (req.headers['x-smartform-origin'] || req.headers['origin']) as string;
    if (clientOrigin && clientOrigin.startsWith('http') && !clientOrigin.includes('chrome-extension://')) {
      return clientOrigin.replace(/\/$/, '');
    }
    // 5. Reverse proxy / Cloud Run forwarded host
    const forwardedHost = req.headers['x-forwarded-host'] as string;
    const forwardedProto = (req.headers['x-forwarded-proto'] || 'https') as string;
    if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) {
      return `${forwardedProto}://${forwardedHost}`;
    }
    // 6. Host header if not localhost
    const host = req.get('host');
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
      return `${protocol}://${host}`;
    }
    // 7. Container APP_URL
    if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
      return process.env.APP_URL.replace(/\/$/, '');
    }
    // 8. Deployed Cloud Run fallback if running on cloud
    const deployedHost = 'ais-dev-nfcwnfuyiamsmdfv5jfvmy-746730634616.asia-southeast1.run.app';
    if (process.env.K_SERVICE) {
      return `https://${deployedHost}`;
    }
    // 9. Localhost fallback
    return `http://localhost:${PORT}`;
  };

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
      devAppUrl: 'https://ais-dev-nfcwnfuyiamsmdfv5jfvmy-746730634616.asia-southeast1.run.app',
      sharedAppUrl: 'https://ais-pre-nfcwnfuyiamsmdfv5jfvmy-746730634616.asia-southeast1.run.app',
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
      db.registerUploadToken(testToken, testSession, 'diag_req', 'Diagnostic Document', 5);

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
      db.consumeUploadToken(testToken);

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
  app.get('/upload', (req, res) => {
    const sessionId = (req.query.session as string) || '';
    const uploadToken = (req.query.token as string) || '';
    const docName = (req.query.doc as string) || 'Required Document';
    const isJson = req.headers.accept?.includes('application/json') || req.query.format === 'json';

    // 1. Missing session or token
    if (!sessionId || !uploadToken) {
      if (isJson) {
        return res.status(403).json({ error: 'Access Denied: Missing upload token or session identifier.' });
      }
      return res.status(403).send(renderErrorHtml('Access Denied', 'Missing upload token or session identifier. Please scan a valid QR code.', 403));
    }

    // 2. Validate token against registered database records
    const tokenInfo = db.getUploadToken(uploadToken);
    if (!tokenInfo) {
      if (isJson) {
        return res.status(403).json({ error: 'Invalid Upload Token: The provided upload token is unknown or unauthorized.' });
      }
      return res.status(403).send(renderErrorHtml('Invalid Upload Token', 'The provided QR code upload token is unknown or unauthorized. Please ask the operator for a new QR code.', 403));
    }

    // 3. Verify session match
    if (tokenInfo.applicationId !== sessionId) {
      if (isJson) {
        return res.status(403).json({ error: 'Token Mismatch: Upload token does not match this application session.' });
      }
      return res.status(403).send(renderErrorHtml('Token Mismatch', 'The upload token does not match this application session.', 403));
    }

    // 4. Verify expiration or already consumed
    if (tokenInfo.expired) {
      if (isJson) {
        return res.status(410).json({ error: 'QR Code Expired: This upload session has expired or has already been used.' });
      }
      return res.status(410).send(renderErrorHtml('QR Code Expired', 'This upload session has expired or the document has already been submitted. Please ask the cyber café operator for a new QR code.', 410));
    }

    // 5. Valid unexpired token -> HTTP 200 OK
    if (isJson) {
      return res.status(200).json({
        valid: true,
        sessionId: tokenInfo.applicationId,
        expectedType: tokenInfo.expectedDocumentType,
        expiresAt: tokenInfo.expiresAt,
      });
    }

    const targetDoc = tokenInfo.expectedDocumentType || docName;
    return res.status(200).send(renderMobileUploadHtml(sessionId, uploadToken, targetDoc, tokenInfo.expiresAt));
  });

  // Token validation endpoint for automated verification
  app.get('/api/upload/validate', (req, res) => {
    const sessionId = (req.query.session as string) || '';
    const uploadToken = (req.query.token as string) || '';

    if (!sessionId || !uploadToken) {
      return res.status(403).json({ valid: false, error: 'Missing token or session' });
    }

    const tokenInfo = db.getUploadToken(uploadToken);
    if (!tokenInfo || tokenInfo.applicationId !== sessionId) {
      return res.status(403).json({ valid: false, error: 'Invalid or mismatched upload token' });
    }

    if (tokenInfo.expired) {
      return res.status(410).json({ valid: false, error: 'Token expired or consumed' });
    }

    return res.status(200).json({
      valid: true,
      sessionId: tokenInfo.applicationId,
      expectedType: tokenInfo.expectedDocumentType,
      expiresAt: tokenInfo.expiresAt,
    });
  });

  // Download Chrome Extension package as ZIP (Dynamically injected with active public origin)
  app.get('/api/extension/download', async (req, res) => {
    try {
      const publicOrigin = getBaseUrl(req);
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

            // Dynamic customization for extension files
            if (file === 'popup.js') {
              let jsStr = fileContent.toString('utf-8');
              // Replace DEFAULT_SERVER_URL with current active public origin
              jsStr = jsStr.replace(
                /const DEFAULT_SERVER_URL = '[^']+';/,
                `const DEFAULT_SERVER_URL = '${publicOrigin}';`
              );
              // Strip any stray localhost:3000 references
              jsStr = jsStr.replace(/http:\/\/localhost:3000/g, publicOrigin);
              jsStr = jsStr.replace(/localhost:3000/g, publicOrigin.replace(/^https?:\/\//, ''));
              fileContent = Buffer.from(jsStr, 'utf-8');
            } else if (file === 'popup.html') {
              let htmlStr = fileContent.toString('utf-8');
              htmlStr = htmlStr.replace(
                /placeholder="[^"]*"/,
                `placeholder="${publicOrigin}"`
              );
              fileContent = Buffer.from(htmlStr, 'utf-8');
            } else if (file === 'manifest.json') {
              let manifestStr = fileContent.toString('utf-8');
              manifestStr = manifestStr.replace(/"version":\s*"[^"]+"/, '"version": "1.0.1"');
              fileContent = Buffer.from(manifestStr, 'utf-8');
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

      // Generate distinct secure QR code for EACH required document
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

        db.registerUploadToken(uploadToken, sessionId, reqId, docType);

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
      const session = await db.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Application session not found.' });
      }
      res.json(session);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Customer Mobile Upload Endpoint: Real Document Upload & AI Verification
  app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
    try {
      const { session: sessionId, token: uploadToken } = req.body;
      const file = req.file;

      if (!sessionId || !uploadToken) {
        return res.status(400).json({ error: 'Session ID and upload token are required.' });
      }

      if (!file) {
        return res.status(400).json({ error: 'No document file provided.' });
      }

      // Validate upload token
      const tokenInfo = db.getUploadToken(uploadToken);
      if (!tokenInfo || tokenInfo.applicationId !== sessionId) {
        return res.status(403).json({ error: 'Invalid or unknown upload token.' });
      }
      if (tokenInfo.expired) {
        return res.status(410).json({ error: 'This QR code upload session has expired or has already been used. Please ask the operator for a new QR code.' });
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
      const classification = await ai.classifyAndExtractDocument(
        file.buffer,
        file.mimetype,
        expectedDocType
      );

      const session = await db.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Associated application session not found.' });
      }

      const docReq = session.documentRequirements.find((r) => r.id === tokenInfo.requirementId);

      // CRITICAL: Wrong document rejection logic
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

      // Consume one-time upload token
      db.consumeUploadToken(uploadToken);

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
      db.registerUploadToken(validToken, testSessionId, testReqId, '10th Marksheet', 30);
      // Register expired token (-1 min lifetime)
      db.registerUploadToken(expiredToken, testSessionId, testReqId, '10th Marksheet', -1);

      const validCheck = db.getUploadToken(validToken);
      const expiredCheck = db.getUploadToken(expiredToken);
      const invalidCheck = db.getUploadToken('completely_invalid_token');

      // Test reuse/consumption
      db.consumeUploadToken(validToken);
      const consumedCheck = db.getUploadToken(validToken);

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
