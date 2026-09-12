/**
 * SmartForm AI Database & Storage Service
 * Supabase PostgreSQL + Private Storage with resilient local fallback
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ApplicationSession,
  DetectedField,
  DocumentRequirement,
  ExtractedField,
  FieldMapping,
  LearningFeedbackEvent,
  UploadTokenRecord,
  ValidatedTokenInfo,
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

// Helper for hashing tokens (opaque string, no modification)
function hashToken(tok: string): string {
  if (!tok || typeof tok !== 'string') return '';
  return crypto.createHash('sha256').update(tok).digest('hex');
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

// Active canonical public URL configured at runtime or via environment
const CANONICAL_APP_URL = 'https://sarkari-saathi.ai.studio';
let activePublicUrl: string = (process.env.PUBLIC_APP_URL || CANONICAL_APP_URL).trim().replace(/\/$/, '');

export const db = {
  isSupabaseConfigured(): boolean {
    return supabaseClient !== null;
  },

  getPublicUrl(): string {
    if (!activePublicUrl || activePublicUrl.includes('localhost') || activePublicUrl.includes('127.0.0.1') || activePublicUrl.includes('ais-dev-')) {
      return CANONICAL_APP_URL;
    }
    return activePublicUrl;
  },

  setPublicUrl(url: string): void {
    const cleaned = (url || '').trim().replace(/\/$/, '');
    if (!cleaned || cleaned.includes('localhost') || cleaned.includes('127.0.0.1') || cleaned.includes('ais-dev-')) {
      activePublicUrl = CANONICAL_APP_URL;
    } else {
      activePublicUrl = cleaned;
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
          const raw = await data.text();
          const parsed = JSON.parse(raw);
          inMemorySessions.set(id, parsed);
          // Cache locally to disk
          const filePath = path.join(SESSIONS_STORAGE_DIR, `${id}.json`);
          await fs.promises.writeFile(filePath, raw, 'utf8').catch(() => {});
          return parsed;
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
    lifetimeMinutes = 60
  ): Promise<UploadTokenRecord> {
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = now + lifetimeMinutes * 60 * 1000;

    const record: UploadTokenRecord = {
      tokenHash,
      rawToken: token,
      sessionId: applicationId,
      applicationId,
      requirementId,
      expectedDocumentType: expectedDocumentType.trim(),
      createdAt: new Date(now).toISOString(),
      expiresAt,
      consumedAt: null,
      status: 'active',
    };

    // 1. L1 Memory Cache
    inMemoryUploadTokens.set(token, record);
    inMemoryUploadTokens.set(tokenHash, record);

    // 2. L2 Local Disk Cache
    try {
      const filePath = path.join(TOKENS_STORAGE_DIR, `${tokenHash}.json`);
      await fs.promises.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
    } catch (err) {
      console.warn('[Database] Local token disk write failed:', err);
    }

    // 3. L3 Supabase Storage (Cross-instance accessible for real mobile phones)
    if (supabaseClient) {
      try {
        await supabaseClient.storage
          .from('smartform_tokens')
          .upload(`tokens/${tokenHash}.json`, JSON.stringify(record), {
            contentType: 'application/json',
            upsert: true,
          });
      } catch (err) {
        console.warn('[Database] Supabase token sync error:', err);
      }
    }

    return record;
  },

  // Read-only token retrieval and validation. NEVER consumes or modifies the token.
  async getUploadToken(token: string): Promise<ValidatedTokenInfo | null> {
    if (!token || typeof token !== 'string') return null;
    const tokenHash = hashToken(token);

    let storageTier: 'L1_memory' | 'L2_disk' | 'L3_supabase_storage' = 'L1_memory';
    let record: UploadTokenRecord | null = null;
    const cached = inMemoryUploadTokens.get(token) || inMemoryUploadTokens.get(tokenHash) || null;

    // If cached in L1 and already consumed or expired, it can never become active again
    if (cached && (cached.status === 'consumed' || Boolean(cached.consumedAt) || Date.now() > cached.expiresAt)) {
      record = cached;
      storageTier = 'L1_memory';
    } else {
      // 1. Check L2 Local Disk Cache
      try {
        const filePath = path.join(TOKENS_STORAGE_DIR, `${tokenHash}.json`);
        if (fs.existsSync(filePath)) {
          const raw = await fs.promises.readFile(filePath, 'utf8');
          const diskRecord = JSON.parse(raw);
          if (diskRecord) {
            record = diskRecord;
            storageTier = 'L2_disk';
          }
        }
      } catch (err) {
        console.warn('[Database] Local token disk read failed:', err);
      }

      // 2. Check L3 Supabase Storage if record is missing or still active (to catch cross-instance consumption)
      if ((!record || record.status === 'active') && supabaseClient) {
        try {
          const { data, error } = await supabaseClient.storage
            .from('smartform_tokens')
            .download(`tokens/${tokenHash}.json`);
          if (data && !error) {
            const raw = await data.text();
            const remoteRecord = JSON.parse(raw);
            if (remoteRecord) {
              record = remoteRecord;
              storageTier = 'L3_supabase_storage';
              // Sync to disk
              const filePath = path.join(TOKENS_STORAGE_DIR, `${tokenHash}.json`);
              await fs.promises.writeFile(filePath, raw, 'utf8').catch(() => {});
            }
          }
        } catch (err) {
          // Supabase network warning ignored
        }
      }

      // If neither disk nor remote yielded anything, fallback to cached
      if (!record && cached) {
        record = cached;
        storageTier = 'L1_memory';
      }

      if (record) {
        inMemoryUploadTokens.set(token, record);
        inMemoryUploadTokens.set(tokenHash, record);
      }
    }

    if (!record) return null;

    // Check validity state strictly (READ-ONLY)
    const isConsumed = record.status === 'consumed' || Boolean(record.consumedAt);
    const isExpiredByTime = Date.now() > record.expiresAt;
    const isExpired = isConsumed || isExpiredByTime || record.status === 'expired';

    let currentStatus: 'active' | 'consumed' | 'expired' = record.status;
    if (isConsumed) {
      currentStatus = 'consumed';
    } else if (isExpiredByTime) {
      currentStatus = 'expired';
    }

    return {
      tokenHash: record.tokenHash,
      sessionId: record.sessionId || record.applicationId,
      applicationId: record.applicationId || record.sessionId,
      requirementId: record.requirementId,
      expectedDocumentType: record.expectedDocumentType,
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
  async consumeUploadToken(token: string): Promise<{ success: boolean; reason?: string }> {
    if (!token || typeof token !== 'string') return { success: false, reason: 'missing_token' };
    const tokenHash = hashToken(token);

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

    const consumedAt = new Date().toISOString();
    const updatedRecord: UploadTokenRecord = {
      tokenHash: current.tokenHash,
      rawToken: token,
      sessionId: current.sessionId,
      applicationId: current.applicationId,
      requirementId: current.requirementId,
      expectedDocumentType: current.expectedDocumentType,
      createdAt: current.createdAt,
      expiresAt: current.expiresAt,
      consumedAt,
      status: 'consumed',
    };

    // 1. Update L1 Memory Cache
    inMemoryUploadTokens.set(token, updatedRecord);
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
        await supabaseClient.storage
          .from('smartform_tokens')
          .upload(`tokens/${tokenHash}.json`, JSON.stringify(updatedRecord), {
            contentType: 'application/json',
            upsert: true,
          });
      } catch (err) {
        console.warn('[Database] Error syncing consumed token to Supabase:', err);
      }
    }

    return { success: true };
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

  // Save learning feedback for field mapping refinement
  saveFeedback(event: LearningFeedbackEvent): void {
    feedbackRecords.push(event);
    if (supabaseClient) {
      supabaseClient.from('learning_feedback').insert({
        form_domain: event.formDomain,
        field_label: event.fieldLabel,
        field_name: event.fieldName,
        ai_predicted_mapping: event.aiPredictedMapping,
        operator_confirmed_mapping: event.operatorConfirmedMapping,
        was_corrected: event.wasCorrected,
      }).then(({ error }) => {
        if (error) console.warn('[Feedback] Supabase insert error:', error.message);
      });
    }
  },

  getRelevantFeedback(formDomain: string): LearningFeedbackEvent[] {
    return feedbackRecords.filter((f) => f.formDomain === formDomain || !f.formDomain);
  },
};
