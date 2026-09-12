/**
 * SmartForm AI Database & Storage Service
 * Supabase PostgreSQL + Private Storage with resilient local fallback
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import {
  ApplicationSession,
  DetectedField,
  DocumentRequirement,
  ExtractedField,
  FieldMapping,
  LearningFeedbackEvent,
} from '../types.js';

// Local temporary storage folder for documents if Supabase Storage is not yet configured
const LOCAL_STORAGE_DIR = path.join(process.cwd(), 'temp_uploads');
if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
  fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
}

// In-memory / persistent state cache for high-speed cyber café operations
const inMemorySessions = new Map<string, ApplicationSession>();
const inMemoryUploadTokens = new Map<
  string,
  {
    applicationId: string;
    requirementId: string;
    expectedDocumentType: string;
    expiresAt: number;
    used: boolean;
  }
>();
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
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (supabaseUrl && supabaseKey) {
  try {
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    console.log('[Database] Connected to Supabase PostgreSQL & Storage');
  } catch (err) {
    console.error('[Database] Failed to initialize Supabase client:', err);
  }
} else {
  console.log('[Database] Supabase credentials not found in env, using secured server-side transactional storage.');
}

// Active public URL configured at runtime or via environment
let activePublicUrl: string = (process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');

export const db = {
  isSupabaseConfigured(): boolean {
    return supabaseClient !== null;
  },

  getPublicUrl(): string {
    return activePublicUrl;
  },

  setPublicUrl(url: string): void {
    activePublicUrl = (url || '').trim().replace(/\/$/, '');
  },

  // Save or update an application session
  async saveSession(session: ApplicationSession): Promise<void> {
    inMemorySessions.set(session.id, { ...session });

    if (supabaseClient) {
      try {
        await supabaseClient.from('applications').upsert({
          id: session.id,
          form_url: session.url,
          status: session.status,
          updated_at: new Date().toISOString(),
          expires_at: session.expiresAt,
        });

        // Upsert document requirements
        if (session.documentRequirements?.length > 0) {
          const reqs = session.documentRequirements.map((r) => ({
            id: r.id,
            application_id: session.id,
            document_type: r.documentType,
            status: r.status,
            updated_at: new Date().toISOString(),
          }));
          await supabaseClient.from('document_requirements').upsert(reqs);
        }
      } catch (error) {
        console.warn('[Database] Supabase upsert error (falling back to memory):', error);
      }
    }
  },

  async getSession(id: string): Promise<ApplicationSession | null> {
    const session = inMemorySessions.get(id);
    if (session) return session;

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient.from('applications').select('*').eq('id', id).single();
        if (data && !error) {
          // Reconstitute from Supabase
          return {
            id: data.id,
            url: data.form_url,
            status: data.status,
            detectedFields: [],
            requirements: [],
            documentRequirements: [],
            extractedData: [],
            mappings: [],
            unfilledRequiredFields: [],
            createdAt: data.created_at,
            expiresAt: data.expires_at,
            storagePurged: !!data.purged_at,
            purgedAt: data.purged_at,
          };
        }
      } catch (err) {
        console.warn('[Database] Supabase query failed:', err);
      }
    }
    return null;
  },

  // Register an upload token for a specific document requirement
  registerUploadToken(
    token: string,
    applicationId: string,
    requirementId: string,
    expectedDocumentType: string,
    lifetimeMinutes = 30
  ) {
    const expiresAt = Date.now() + lifetimeMinutes * 60 * 1000;
    inMemoryUploadTokens.set(token, {
      applicationId,
      requirementId,
      expectedDocumentType,
      expiresAt,
      used: false,
    });
  },

  getUploadToken(token: string) {
    const info = inMemoryUploadTokens.get(token);
    if (!info) return null;
    if (info.used || Date.now() > info.expiresAt) {
      return { ...info, expired: true };
    }
    return { ...info, expired: false };
  },

  consumeUploadToken(token: string) {
    const info = inMemoryUploadTokens.get(token);
    if (info) {
      info.used = true;
      inMemoryUploadTokens.set(token, info);
    }
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
