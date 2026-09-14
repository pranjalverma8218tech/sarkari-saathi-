/**
 * SmartForm AI Database & Storage Service
 * Supabase PostgreSQL + Private Storage with resilient local fallback
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import {
  AnalyzedRequirement,
  ApplicationSession,
  CanonicalDocumentRequirement,
  DetectedField,
  DocumentRequirement,
  ExtractedField,
  FieldMapping,
  LearningFeedbackEvent,
  UploadSession,
  UploadTokenRecord,
  ValidatedTokenInfo,
  WorkflowMode,
} from '../types.js';

// Local temporary storage folder for documents if Supabase Storage is not yet configured
const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'temp_uploads');
const TOKENS_STORAGE_DIR = path.join(LOCAL_STORAGE_DIR, 'tokens');
const SESSIONS_STORAGE_DIR = path.join(LOCAL_STORAGE_DIR, 'sessions');

[LOCAL_STORAGE_DIR, TOKENS_STORAGE_DIR, SESSIONS_STORAGE_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Helper for hashing tokens (opaque string, case-insensitive for hex)
function hashToken(tok: string): string {
  if (!tok || typeof tok !== 'string') return '';
  const trimmed = tok.trim().replace(/^['"]|['"]$/g, '');
  const normalized = /^[a-f0-9]+$/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// In-memory / persistent state cache for high-speed cyber café operations
const inMemorySessions = new Map<string, ApplicationSession>();
const inMemoryUploadTokens = new Map<string, UploadTokenRecord>();
const storedFiles = new Map<
  string,
  {
    localFilePath: string;
    originalName: string;
    mimeType: string;
    size: number;
    storagePath: string;
    deleted: boolean;
  }
>();
const feedbackRecords: LearningFeedbackEvent[] = [];
const FEEDBACK_STORAGE_FILE = path.join(LOCAL_STORAGE_DIR, 'learning_feedback.json');

// Initialize local persistent learning feedback
try {
  if (fs.existsSync(FEEDBACK_STORAGE_FILE)) {
    const rawFb = fs.readFileSync(FEEDBACK_STORAGE_FILE, 'utf8');
    const parsedFb = JSON.parse(rawFb);
    if (Array.isArray(parsedFb)) {
      feedbackRecords.push(...parsedFb);
    }
  }
} catch (fbErr) {
  console.warn('[Database] Notice initializing learning feedback from disk:', fbErr);
}

// Initialize Supabase Client if credentials exist
let supabaseClient: SupabaseClient | null = null;
let rawSupabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim();

if (rawSupabaseUrl && supabaseKey) {
  // Normalize if user provided just the Supabase project reference ID (e.g. vommzhcbnitdwxwmcpin)
  let normalizedUrl = rawSupabaseUrl;
  if (/^[a-z0-9_-]+$/i.test(normalizedUrl)) {
    normalizedUrl = `https://${normalizedUrl}.supabase.co`;
  } else if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  let isValidHttpUrl = false;
  try {
    const parsed = new URL(normalizedUrl);
    isValidHttpUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    isValidHttpUrl = false;
  }

  if (isValidHttpUrl) {
    try {
      supabaseClient = createClient(normalizedUrl, supabaseKey, {
        auth: { persistSession: false },
      });
      console.log(`[Database] Connected to Supabase at ${normalizedUrl}`);

      // Auto-ensure required storage buckets exist in Supabase
      (async () => {
        try {
          const requiredBuckets = ['smartform_tokens', 'smartform_sessions', 'private_documents'];
          for (const bucket of requiredBuckets) {
            try {
              await supabaseClient!.storage.createBucket(bucket, { public: false });
            } catch {
              // Bucket already exists or created
            }
          }
        } catch (err) {
          console.warn('[Database] Supabase bucket initialization notice:', err);
        }
      })();
    } catch (err) {
      console.warn('[Database] Supabase initialization notice, falling back to local transactional storage:', err);
      supabaseClient = null;
    }
  } else {
    console.warn('[Database] Invalid SUPABASE_URL format provided, falling back to local transactional storage.');
  }
} else {
  console.log('[Database] Supabase credentials not found in env, using secured server-side transactional storage.');
}

// Canonical production public application URL
export const CANONICAL_PUBLIC_APP_URL = 'https://sarkari-saathi.ai.studio';

export function isInternalOrBlockedHost(hostOrUrl: string): boolean {
  if (!hostOrUrl) return true;
  const lower = hostOrUrl.toLowerCase();
  return (
    lower.includes('localhost') ||
    lower.includes('127.0.0.1') ||
    lower.includes('ais-dev-') ||
    lower.includes('ais-pre-') ||
    lower.includes('aistudio.google.com') ||
    lower.includes('.corp.google.com') ||
    lower.includes('googleusercontent.com')
  );
}

// Runtime-configured public URL
let configuredCustomPublicUrl: string | null = null;
if (
  process.env.PUBLIC_APP_URL &&
  process.env.PUBLIC_APP_URL !== 'MY_PUBLIC_APP_URL' &&
  !isInternalOrBlockedHost(process.env.PUBLIC_APP_URL)
) {
  configuredCustomPublicUrl = process.env.PUBLIC_APP_URL.trim().replace(/\/$/, '');
}

export const db = {
  isSupabaseConfigured(): boolean {
    return supabaseClient !== null;
  },

  getCustomPublicUrl(): string | null {
    return configuredCustomPublicUrl;
  },

  getPublicUrl(): string {
    if (configuredCustomPublicUrl && !isInternalOrBlockedHost(configuredCustomPublicUrl)) {
      return configuredCustomPublicUrl;
    }
    return CANONICAL_PUBLIC_APP_URL;
  },

  setPublicUrl(url: string): void {
    const cleaned = (url || '').trim().replace(/\/$/, '');
    if (!cleaned || isInternalOrBlockedHost(cleaned)) {
      configuredCustomPublicUrl = null;
    } else {
      configuredCustomPublicUrl = cleaned;
    }
  },

  // Save or update an application session across L1 memory, L2 disk, and L3 Supabase
  async saveSession(session: ApplicationSession): Promise<void> {
    inMemorySessions.set(session.id, { ...session });

    // L2 Disk Cache
    try {
      const filePath = path.join(SESSIONS_STORAGE_DIR, `${session.id}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Database] Failed to cache session locally:', err);
    }

    // L3 Supabase Storage for multi-instance synchronization
    if (supabaseClient) {
      try {
        await supabaseClient.storage
          .from('smartform_sessions')
          .upload(`sessions/${session.id}.json`, JSON.stringify(session), {
            contentType: 'application/json',
            upsert: true,
          });
      } catch (error) {
        console.warn('[Database] Supabase session sync warning:', error);
      }
    }
  },

  async getSession(id: string): Promise<ApplicationSession | null> {
    if (!id) return null;

    // 1. L1 Memory Cache
    const session = inMemorySessions.get(id);
    if (session) return session;

    // 2. L2 Local Disk Cache
    try {
      const filePath = path.join(SESSIONS_STORAGE_DIR, `${id}.json`);
      if (fs.existsSync(filePath)) {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        inMemorySessions.set(id, parsed);
        return parsed;
      }
    } catch (err) {
      console.warn('[Database] Failed to read session from disk:', err);
    }

    // 3. L3 Supabase Storage cross-instance lookup
    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.storage
          .from('smartform_sessions')
          .download(`sessions/${id}.json`);
        if (data && !error) {
          let raw = '';
          if (typeof (data as any).text === 'function') {
            raw = await (data as any).text();
          } else if (Buffer.isBuffer(data)) {
            raw = data.toString('utf8');
          } else if (typeof data === 'string') {
            raw = data;
          } else if (data instanceof ArrayBuffer) {
            raw = Buffer.from(data).toString('utf8');
          }

          if (raw) {
            const parsed = JSON.parse(raw);
            inMemorySessions.set(id, parsed);
            // Cache locally to disk
            const filePath = path.join(SESSIONS_STORAGE_DIR, `${id}.json`);
            await fs.promises.writeFile(filePath, raw, 'utf8').catch(() => {});
            return parsed;
          }
        }
      } catch (err) {
        console.warn('[Database] Supabase session query failed:', err);
      }
    }

    return null;
  },

  // Register an upload token for a specific document requirement
  async registerUploadToken(
    token: string,
    applicationId: string,
    requirementId: string,
    expectedDocumentType: string,
    lifetimeMinutes = 60,
    metadata?: {
      workflowMode?: 'URL_PASTE' | 'EXTENSION_INSPECTION';
      scope?: string;
      requiredDocuments?: DocumentRequirement[];
      formUrl?: string;
    }
  ): Promise<UploadTokenRecord> {
    const cleanToken = token.trim().replace(/^['"]|['"]$/g, '');
    const tokenHash = hashToken(cleanToken);
    const now = Date.now();
    const expiresAt = now + lifetimeMinutes * 60 * 1000;

    const record: UploadTokenRecord = {
      tokenHash,
      rawToken: cleanToken,
      sessionId: applicationId,
      applicationId,
      workflowMode: metadata?.workflowMode || 'URL_PASTE',
      scope: metadata?.scope || (requirementId === 'ALL' ? 'SESSION_ALL_DOCS' : 'SINGLE_DOC'),
      formUrl: metadata?.formUrl || '',
      requirementId,
      expectedDocumentType: expectedDocumentType.trim(),
      requiredDocuments: metadata?.requiredDocuments,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      consumedAt: null,
      status: 'active',
    };

    // 1. L3 Supabase Storage - Authoritative Single Source of Truth for Cross-Instance Sync
    if (supabaseClient) {
      try {
        const jsonPayload = JSON.stringify(record);
        const { error: upErr } = await supabaseClient.storage
          .from('smartform_tokens')
          .upload(`tokens/${tokenHash}.json`, jsonPayload, {
            contentType: 'application/json',
            upsert: true,
          });

        if (upErr) {
          console.error('[Database] Supabase authoritative token upload failed:', upErr);
        } else {
          console.log(`[Database] Persisted authoritative token hash ${tokenHash.slice(0, 8)}... to Supabase smartform_tokens`);
        }

        // Also save indexed by cleanToken for direct lookup resilience
        await supabaseClient.storage
          .from('smartform_tokens')
          .upload(`tokens/${cleanToken}.json`, jsonPayload, {
            contentType: 'application/json',
            upsert: true,
          }).catch(() => {});
      } catch (err) {
        console.error('[Database] Supabase token sync exception:', err);
      }
    }

    // 2. L1 Memory Cache (Optimization)
    inMemoryUploadTokens.set(cleanToken, record);
    inMemoryUploadTokens.set(cleanToken.toLowerCase(), record);
    inMemoryUploadTokens.set(tokenHash, record);

    // 3. L2 Local Disk Cache (Optimization)
    try {
      const filePath = path.join(TOKENS_STORAGE_DIR, `${tokenHash}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Database] Local token disk write failed:', err);
    }

    return record;
  },

  // Authoritative token retrieval and validation. NEVER consumes or modifies the token.
  async getUploadToken(token: string): Promise<ValidatedTokenInfo | null> {
    if (!token || typeof token !== 'string') return null;
    const cleanToken = decodeURIComponent(token).trim().replace(/^['"]|['"]$/g, '');
    if (!cleanToken) return null;

    const is64Hex = /^[a-f0-9]{64}$/i.test(cleanToken);
    const tokenHash = is64Hex ? cleanToken.toLowerCase() : hashToken(cleanToken);

    let storageTier: 'L1_memory' | 'L2_disk' | 'L3_supabase_storage' = 'L3_supabase_storage';
    let record: UploadTokenRecord | null = null;

    // 1. Authoritative Look-up: Query Supabase Storage first (Single Source of Truth)
    if (supabaseClient) {
      try {
        let remoteData: any = null;
        const res1 = await supabaseClient.storage
          .from('smartform_tokens')
          .download(`tokens/${tokenHash}.json`);

        if (res1.data && !res1.error) {
          remoteData = res1.data;
        } else if (!is64Hex) {
          const res2 = await supabaseClient.storage
            .from('smartform_tokens')
            .download(`tokens/${cleanToken}.json`);
          if (res2.data && !res2.error) {
            remoteData = res2.data;
          }
        }

        if (remoteData) {
          let raw = '';
          if (typeof remoteData.text === 'function') {
            raw = await remoteData.text();
          } else if (Buffer.isBuffer(remoteData)) {
            raw = remoteData.toString('utf8');
          } else if (typeof remoteData === 'string') {
            raw = remoteData;
          } else if (remoteData instanceof ArrayBuffer) {
            raw = Buffer.from(remoteData).toString('utf8');
          } else if (typeof (remoteData as any).arrayBuffer === 'function') {
            const ab = await (remoteData as any).arrayBuffer();
            raw = Buffer.from(ab).toString('utf8');
          }

          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && (parsed.tokenHash || parsed.rawToken || parsed.sessionId)) {
              record = parsed;
              storageTier = 'L3_supabase_storage';
              // Update local caches with authoritative Supabase truth
              inMemoryUploadTokens.set(cleanToken, record);
              inMemoryUploadTokens.set(tokenHash, record);
              const filePath = path.join(TOKENS_STORAGE_DIR, `${tokenHash}.json`);
              await fs.promises.writeFile(filePath, raw, 'utf8').catch(() => {});
            }
          }
        }
      } catch (err) {
        console.warn('[Database] Supabase authoritative token lookup notice:', err);
      }
    }

    // 2. Fallback to Local Caches if Supabase is offline or returned nothing
    if (!record) {
      const cached =
        inMemoryUploadTokens.get(cleanToken) ||
        inMemoryUploadTokens.get(cleanToken.toLowerCase()) ||
        inMemoryUploadTokens.get(tokenHash) ||
        null;
      if (cached) {
        record = cached;
        storageTier = 'L1_memory';
      } else {
        try {
          const filePath = path.join(TOKENS_STORAGE_DIR, `${tokenHash}.json`);
          if (fs.existsSync(filePath)) {
            const raw = await fs.promises.readFile(filePath, 'utf8');
            const diskRecord = JSON.parse(raw);
            if (diskRecord) {
              record = diskRecord;
              storageTier = 'L2_disk';
              inMemoryUploadTokens.set(cleanToken, record);
              inMemoryUploadTokens.set(tokenHash, record);
            }
          }
        } catch (err) {
          console.warn('[Database] Local token disk read failed:', err);
        }
      }
    }

    // 3. Fallback to active sessions (in memory and on disk) if token matches any document requirement
    if (!record) {
      for (const sess of inMemorySessions.values()) {
        const found = sess.documentRequirements?.find(
          (d) =>
            d.uploadToken === cleanToken ||
            d.uploadToken?.toLowerCase() === cleanToken.toLowerCase() ||
            (d.uploadToken && hashToken(d.uploadToken) === tokenHash)
        );
        if (found) {
          record = {
            tokenHash,
            rawToken: cleanToken,
            sessionId: sess.id,
            applicationId: sess.id,
            workflowMode: sess.workflowMode,
            scope: 'SINGLE_DOC',
            formUrl: sess.url,
            requirementId: found.id,
            expectedDocumentType: found.documentType,
            requiredDocuments: sess.documentRequirements,
            createdAt: sess.createdAt,
            expiresAt: new Date(sess.expiresAt).getTime() || Date.now() + 3600000,
            consumedAt: null,
            status: found.status === 'verified' ? 'consumed' : 'active',
          };
          storageTier = 'L1_memory';
          break;
        }
      }
    }

    if (!record) return null;

    // Check validity state strictly (READ-ONLY)
    const isConsumed = record.status === 'consumed' || Boolean(record.consumedAt);
    const isExpiredByTime = Date.now() > record.expiresAt;
    const isExpired = isExpiredByTime || record.status === 'expired';

    let currentStatus: 'active' | 'consumed' | 'expired' = record.status;
    if (isConsumed) {
      currentStatus = 'consumed';
    } else if (isExpiredByTime) {
      currentStatus = 'expired';
    }

    return {
      tokenHash: record.tokenHash,
      rawToken: record.rawToken || cleanToken,
      sessionId: record.sessionId || record.applicationId,
      applicationId: record.applicationId || record.sessionId,
      workflowMode: record.workflowMode,
      scope: record.scope,
      formUrl: record.formUrl,
      requirementId: record.requirementId,
      expectedDocumentType: record.expectedDocumentType,
      requiredDocuments: record.requiredDocuments,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      consumedAt: record.consumedAt,
      status: currentStatus,
      expired: isExpired,
      consumed: isConsumed,
      storageTier,
    };
  },

  // Atomically consume token. Only succeeds if currently active and unconsumed.
  // Note: For multi-document session tokens (requirementId === 'ALL' or scope === 'SESSION_ALL_DOCS'),
  // the token is preserved until all documents are verified or force=true
  async consumeUploadToken(token: string, force = false): Promise<{ success: boolean; reason?: string; isSessionToken?: boolean }> {
    if (!token || typeof token !== 'string') return { success: false, reason: 'missing_token' };
    const cleanToken = decodeURIComponent(token).trim().replace(/^['"]|['"]$/g, '');
    const tokenHash = /^[a-f0-9]{64}$/i.test(cleanToken) ? cleanToken.toLowerCase() : hashToken(cleanToken);

    // Check current state
    const current = await this.getUploadToken(token);
    if (!current) {
      return { success: false, reason: 'token_not_found' };
    }
    if (current.consumed || current.status === 'consumed') {
      return { success: false, reason: 'already_consumed' };
    }
    if (current.expired || current.status === 'expired') {
      return { success: false, reason: 'expired' };
    }

    // If it's a multi-document session token and force is not requested, keep active for remaining documents
    if ((current.requirementId === 'ALL' || current.scope === 'SESSION_ALL_DOCS') && !force) {
      return { success: true, isSessionToken: true };
    }

    const consumedAt = new Date().toISOString();
    const updatedRecord: UploadTokenRecord = {
      tokenHash: current.tokenHash,
      rawToken: current.rawToken || cleanToken,
      sessionId: current.sessionId,
      applicationId: current.applicationId,
      workflowMode: current.workflowMode,
      scope: current.scope,
      formUrl: current.formUrl,
      requirementId: current.requirementId,
      expectedDocumentType: current.expectedDocumentType,
      requiredDocuments: current.requiredDocuments,
      createdAt: current.createdAt,
      expiresAt: current.expiresAt,
      consumedAt,
      status: 'consumed',
    };

    // 1. Update L1 Memory Cache
    inMemoryUploadTokens.set(cleanToken, updatedRecord);
    inMemoryUploadTokens.set(tokenHash, updatedRecord);

    // 2. Update L2 Local Disk Cache
    try {
      const filePath = path.join(TOKENS_STORAGE_DIR, `${tokenHash}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(updatedRecord, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Database] Error updating consumed token on disk:', err);
    }

    // 3. Update L3 Supabase Storage
    if (supabaseClient) {
      try {
        const payload = JSON.stringify(updatedRecord);
        await supabaseClient.storage
          .from('smartform_tokens')
          .upload(`tokens/${tokenHash}.json`, payload, {
            contentType: 'application/json',
            upsert: true,
          });
        await supabaseClient.storage
          .from('smartform_tokens')
          .upload(`tokens/${cleanToken}.json`, payload, {
            contentType: 'application/json',
            upsert: true,
          }).catch(() => {});
      } catch (err) {
        console.warn('[Database] Error syncing consumed token to Supabase:', err);
      }
    }

    return { success: true };
  },

  async getUploadSessionSummary(sessionId: string): Promise<any | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;
    const reqs = session.documentRequirements || [];
    const uploaded = reqs.filter((r) => r.status === 'uploaded' || r.status === 'verified' || r.status === 'processing');
    const processing = reqs.filter((r) => r.status === 'processing' || r.status === 'uploading');
    const completed = reqs.filter((r) => r.status === 'verified');
    const rejected = reqs.filter((r) => r.status === 'rejected');
    const failed = reqs.filter((r) => r.status === 'failed');
    const totalRequired = reqs.length;
    const totalVerified = completed.length;
    const isAllVerified = totalRequired > 0 && totalVerified === totalRequired;

    return {
      sessionId: session.id,
      token: session.sessionUploadToken || '',
      requiredDocuments: reqs,
      uploadedDocuments: uploaded,
      processingDocuments: processing,
      completedDocuments: completed,
      rejectedDocuments: rejected,
      failedDocuments: failed,
      overallStatus: isAllVerified
        ? 'ready_for_review'
        : processing.length > 0
        ? 'processing'
        : 'waiting_documents',
      totalRequired,
      totalVerified,
      isAllVerified,
    };
  },

  // Save uploaded file to private storage
  async saveDocumentFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string,
    applicationId: string,
    docType: string
  ): Promise<{ storageKey: string; localPath: string }> {
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    const sanitizedDoc = docType.replace(/[^a-zA-Z0-9]/g, '_');
    const ext = path.extname(originalName) || '.bin';
    const storageKey = `sessions/${applicationId}/${sanitizedDoc}_${randomSuffix}${ext}`;
    const localPath = path.join(LOCAL_STORAGE_DIR, `${applicationId}_${sanitizedDoc}_${randomSuffix}${ext}`);

    // Write file locally
    await fs.promises.writeFile(localPath, fileBuffer);

    // If Supabase Storage is configured, upload to private bucket
    if (supabaseClient) {
      try {
        await supabaseClient.storage.from('private_documents').upload(storageKey, fileBuffer, {
          contentType: mimeType,
          upsert: true,
        });
      } catch (err) {
        console.warn('[Storage] Supabase private upload failed:', err);
      }
    }

    storedFiles.set(storageKey, {
      localFilePath: localPath,
      originalName,
      mimeType,
      size: fileBuffer.length,
      storagePath: storageKey,
      deleted: false,
    });

    return { storageKey, localPath };
  },

  // Permanently purge all temporary files & personal extracted data for a session
  async purgeSession(applicationId: string): Promise<{ success: boolean; purgedFilesCount: number; message: string }> {
    const session = inMemorySessions.get(applicationId);
    if (!session) {
      return { success: false, purgedFilesCount: 0, message: 'Session not found.' };
    }

    let purgedCount = 0;
    const errors: string[] = [];

    // 1. Purge local files
    for (const [key, fileMeta] of storedFiles.entries()) {
      if (key.includes(applicationId) && !fileMeta.deleted) {
        try {
          if (fs.existsSync(fileMeta.localFilePath)) {
            await fs.promises.unlink(fileMeta.localFilePath);
          }
          fileMeta.deleted = true;
          purgedCount++;
        } catch (e: any) {
          errors.push(`Failed to delete local file ${fileMeta.localFilePath}: ${e.message}`);
        }
      }
    }

    // 2. Purge Supabase Storage if configured
    if (supabaseClient) {
      try {
        const { data: listData } = await supabaseClient.storage.from('private_documents').list(`sessions/${applicationId}`);
        if (listData && listData.length > 0) {
          const filePaths = listData.map((f) => `sessions/${applicationId}/${f.name}`);
          await supabaseClient.storage.from('private_documents').remove(filePaths);
          purgedCount += filePaths.length;
        }
      } catch (err: any) {
        errors.push(`Supabase storage purge error: ${err.message}`);
      }
    }

    // 3. Clear sensitive extracted values and mark session as purged
    session.extractedData = [];
    session.mappings.forEach((m) => {
      m.extractedValue = '***PURGED***';
    });
    session.status = 'purged';
    session.storagePurged = true;
    session.purgedAt = new Date().toISOString();
    inMemorySessions.set(applicationId, session);

    if (supabaseClient) {
      try {
        await supabaseClient.from('applications').update({
          status: 'purged',
          purged_at: session.purgedAt,
        }).eq('id', applicationId);

        await supabaseClient.from('extracted_data').delete().eq('application_id', applicationId);
      } catch (err: any) {
        errors.push(`Supabase DB purge error: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        purgedFilesCount: purgedCount,
        message: `Temporary file deletion pending. ${errors.join(', ')}`,
      };
    }

    return {
      success: true,
      purgedFilesCount: purgedCount,
      message: 'All uploaded documents and temporary extracted personal data were permanently purged.',
    };
  },

  // Save learning feedback for field mapping & document classification refinement
  saveFeedback(event: LearningFeedbackEvent): void {
    const enriched: LearningFeedbackEvent = {
      ...event,
      id: event.id || 'fb_' + crypto.randomUUID().slice(0, 8),
      createdAt: event.createdAt || new Date().toISOString(),
      verified: event.verified ?? true,
      wasCorrected: event.wasCorrected ?? true,
    };
    feedbackRecords.push(enriched);

    // Persist to local disk
    try {
      fs.writeFileSync(FEEDBACK_STORAGE_FILE, JSON.stringify(feedbackRecords, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Database] Local learning feedback disk write warning:', err);
    }

    // Persist to Supabase if configured
    if (supabaseClient) {
      supabaseClient
        .from('learning_feedback')
        .insert({
          id: enriched.id,
          form_domain: enriched.formDomain,
          field_label: enriched.fieldLabel,
          field_name: enriched.fieldName,
          ai_predicted_mapping: enriched.aiPredictedMapping || enriched.previousMapping,
          operator_confirmed_mapping: enriched.operatorConfirmedMapping || enriched.correctedMapping || '',
          was_corrected: enriched.wasCorrected,
        })
        .then(({ error }) => {
          if (error) console.warn('[Feedback] Supabase insert warning:', error.message);
        });
    }
  },

  getRelevantFeedback(formDomain: string): LearningFeedbackEvent[] {
    if (!formDomain) return [...feedbackRecords];
    const cleanDomain = formDomain.toLowerCase().replace(/^www\./, '');
    return feedbackRecords.filter((f) => {
      if (!f.formDomain) return true;
      const fDomain = f.formDomain.toLowerCase().replace(/^www\./, '');
      return cleanDomain.includes(fDomain) || fDomain.includes(cleanDomain);
    });
  },

  createUnifiedUploadSession(params: CreateUnifiedSessionParams): Promise<UnifiedUploadSessionResult> {
    return createUnifiedUploadSession(params);
  },

  async regenerateDocumentTokenAndQr(
    sessionId: string,
    requirementId: string,
    baseUrl?: string
  ): Promise<DocumentRequirement | null> {
    const session = await db.getSession(sessionId);
    if (!session) return null;

    const docReq = session.documentRequirements.find((d) => d.id === requirementId);
    if (!docReq) return null;

    const rawBaseUrl = (baseUrl || db.getPublicUrl()).trim().replace(/\/$/, '');
    const cleanBaseUrl = isInternalOrBlockedHost(rawBaseUrl) ? CANONICAL_PUBLIC_APP_URL : rawBaseUrl;

    const newDocToken = crypto.randomBytes(16).toString('hex');
    const newUploadUrl = `${cleanBaseUrl}/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(newDocToken)}&doc=${encodeURIComponent(docReq.documentType)}&req=${encodeURIComponent(docReq.id)}`;

    const newQrDataUrl = await QRCode.toDataURL(newUploadUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    await db.registerUploadToken(newDocToken, sessionId, docReq.id, docReq.documentType, 120, {
      workflowMode: session.workflowMode,
      scope: 'SINGLE_DOC',
      formUrl: session.url,
    });

    docReq.uploadToken = newDocToken;
    docReq.uploadUrl = newUploadUrl;
    docReq.qrDataUrl = newQrDataUrl;
    if (docReq.status === 'rejected') {
      docReq.status = 'pending';
      delete docReq.rejectionReason;
    }

    await db.saveSession(session);
    return docReq;
  },
};

function inferDocCategory(name: string): string {
  const l = name.toLowerCase();
  if (
    l.includes('aadhaar') ||
    l.includes('identity') ||
    l.includes('pan') ||
    l.includes('voter') ||
    (l.includes('passport') && !l.includes('photo'))
  ) {
    return 'identity_document';
  }
  if (
    l.includes('marksheet') ||
    l.includes('10th') ||
    l.includes('12th') ||
    l.includes('graduation') ||
    l.includes('degree') ||
    l.includes('matric') ||
    l.includes('intermediate')
  ) {
    return 'education_document';
  }
  if (l.includes('photo') || l.includes('picture')) return 'photo';
  if (l.includes('sign')) return 'signature';
  if (
    l.includes('certificate') ||
    l.includes('caste') ||
    l.includes('income') ||
    l.includes('domicile') ||
    l.includes('ews')
  ) {
    return 'certificate';
  }
  return 'other';
}

export interface CreateUnifiedSessionParams {
  applicationId?: string;
  workflowMode: WorkflowMode;
  requiredDocuments?: (string | DocumentRequirement)[];
  detectedFields?: DetectedField[];
  fieldRequirements?: AnalyzedRequirement[];
  formUrl?: string;
  pastedUrl?: string;
  inspectedUrl?: string;
  pageTitle?: string;
  formActionUrl?: string;
  targetTabId?: number;
  targetWindowId?: number;
  targetOrigin?: string;
  baseUrl: string;
}

export interface UnifiedUploadSessionResult {
  session: ApplicationSession;
  uploadSession: UploadSession;
  sessionId: string;
  secureToken: string;
  qrUrl: string;
  qrDataUrl: string;
  requiredDocuments: DocumentRequirement[];
}

/**
 * Authoritative Unified Upload Session Generator
 * ONE APPLICATION = ONE QR CODE
 * Generates single secure token, single QR URL, canonical requirements array.
 */
export async function createUnifiedUploadSession(
  params: CreateUnifiedSessionParams
): Promise<UnifiedUploadSessionResult> {
  const sessionId = params.applicationId || 'app_' + crypto.randomUUID().slice(0, 8);
  const secureToken = crypto.randomBytes(16).toString('hex');
  const rawBaseUrl = (params.baseUrl || db.getPublicUrl()).trim().replace(/\/$/, '');
  const cleanBaseUrl = isInternalOrBlockedHost(rawBaseUrl) ? CANONICAL_PUBLIC_APP_URL : rawBaseUrl;
  const qrUrl = `${cleanBaseUrl}/upload?session=${sessionId}&token=${secureToken}`;

  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 320,
    margin: 2,
    color: { dark: '#0f172a', light: '#ffffff' },
  });

  const activeUrl = params.formUrl || params.pastedUrl || params.inspectedUrl || '';
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + 120 * 60 * 1000).toISOString();

  const canonicalDocs: DocumentRequirement[] = [];
  const rawDocs =
    params.requiredDocuments && params.requiredDocuments.length > 0
      ? params.requiredDocuments
      : [
          'Aadhaar Card',
          'High School Marksheet',
          'Intermediate Marksheet',
          'Graduation Marksheet',
          'Photograph',
          'Signature',
          'Caste Certificate',
          'Income Certificate',
        ];

  for (let i = 0; i < rawDocs.length; i++) {
    const raw = rawDocs[i];
    const docName = typeof raw === 'string' ? raw.trim() : (raw.name || raw.documentType).trim();
    const reqId = typeof raw === 'object' && raw.id ? raw.id : `req_${i + 1}_${crypto.randomUUID().slice(0, 6)}`;
    const category = inferDocCategory(docName);

    // Cryptographically secure token unique to THIS document requirement
    const docToken = (typeof raw === 'object' && raw.uploadToken) ? raw.uploadToken : crypto.randomBytes(16).toString('hex');
    const docUploadUrl = `${cleanBaseUrl}/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(docToken)}&doc=${encodeURIComponent(docName)}&req=${encodeURIComponent(reqId)}`;

    const docQrDataUrl = await QRCode.toDataURL(docUploadUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' },
    });

    // Register token in authoritative store (Supabase + Local Cache)
    await db.registerUploadToken(docToken, sessionId, reqId, docName, 120, {
      workflowMode: params.workflowMode,
      scope: 'SINGLE_DOC',
      formUrl: activeUrl,
    });

    canonicalDocs.push({
      id: reqId,
      applicationId: sessionId,
      name: docName,
      type: category,
      documentType: docName,
      required: true,
      acceptedMimeTypes: docName.toLowerCase().includes('pdf')
        ? ['application/pdf']
        : ['image/jpeg', 'image/png', 'application/pdf'],
      maxSizeMB: 10,
      uploadToken: docToken,
      qrDataUrl: docQrDataUrl,
      uploadUrl: docUploadUrl,
      status: (typeof raw === 'object' && raw.status) || 'pending',
      rejectionReason: typeof raw === 'object' ? raw.rejectionReason : undefined,
      detectedType: typeof raw === 'object' ? raw.detectedType : undefined,
      uploadedFileName: typeof raw === 'object' ? raw.uploadedFileName : undefined,
      fileSizeBytes: typeof raw === 'object' ? raw.fileSizeBytes : undefined,
      uploadedAt: typeof raw === 'object' ? raw.uploadedAt : undefined,
      verifiedAt: typeof raw === 'object' ? raw.verifiedAt : undefined,
    });
  }

  // Also register session-level upload token for overall application session
  await db.registerUploadToken(secureToken, sessionId, 'ALL', 'ALL', 120, {
    workflowMode: params.workflowMode,
    scope: 'SESSION_ALL_DOCS',
    requiredDocuments: canonicalDocs,
    formUrl: activeUrl,
  });

  const initialMappings: FieldMapping[] = (params.fieldRequirements || []).map((fr, idx) => ({
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
    workflowMode: params.workflowMode,
    url: activeUrl,
    pastedUrl: params.pastedUrl,
    inspectedUrl: params.inspectedUrl,
    pageTitle: params.pageTitle || '',
    formActionUrl: params.formActionUrl || '',
    inspectedAt: nowIso,
    inspectionState: 'active_inspected',
    targetTabId: params.targetTabId,
    targetWindowId: params.targetWindowId,
    targetOrigin: params.targetOrigin,
    status: 'waiting_documents',
    detectedFields: params.detectedFields || [],
    requirements: params.fieldRequirements || [],
    documentRequirements: canonicalDocs,
    sessionUploadToken: secureToken,
    sessionQrDataUrl: qrDataUrl,
    sessionUploadUrl: qrUrl,
    extractedData: [],
    mappings: initialMappings,
    unfilledRequiredFields: [],
    createdAt: nowIso,
    expiresAt: expiresIso,
    storagePurged: false,
  };

  await db.saveSession(session);

  const uploadSession: UploadSession = {
    sessionId,
    applicationId: sessionId,
    workflowMode: params.workflowMode,
    secureToken,
    qrUrl,
    qrDataUrl,
    requiredDocuments: canonicalDocs,
    uploadedDocuments: [],
    processingDocuments: [],
    verifiedDocuments: [],
    rejectedDocuments: [],
    failedDocuments: [],
    status: 'waiting_documents',
    createdAt: nowIso,
    expiresAt: expiresIso,
  };

  return {
    session,
    uploadSession,
    sessionId,
    secureToken,
    qrUrl,
    qrDataUrl,
    requiredDocuments: canonicalDocs,
  };
}
