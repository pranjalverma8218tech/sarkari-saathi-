/**
 * SmartForm AI - Shared Type Definitions
 * Cyber Café Government Form Assistant
 */

export interface DetectedField {
  fieldType: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'email' | 'tel' | 'number' | 'date';
  label: string;
  name: string;
  id: string;
  selector: string;
  required: boolean;
  placeholder?: string;
  autocomplete?: string;
  ariaLabel?: string;
  nearbyText?: string;
  options?: string[]; // For select, radio
  currentValue?: string;
}

export interface FormStructure {
  url: string;
  title?: string;
  domain?: string;
  fields: DetectedField[];
}

export interface AnalyzedRequirement {
  fieldKey: string;
  targetFieldIdOrName: string;
  label: string;
  required: boolean;
  obtainableFromDocument: boolean;
  sourceDocumentType?: string; // e.g. "10th Marksheet", "Identity Proof", "Passport Photo"
  isManualEntry: boolean;
  notes?: string;
}

export interface FormAnalysisResult {
  formTitle: string;
  summary: string;
  requiredDocuments: string[]; // e.g. ["10th Marksheet", "Identity Proof"]
  fieldRequirements: AnalyzedRequirement[];
}

export type DocumentStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'verified'
  | 'rejected'
  | 'failed';

export interface DocumentRequirement {
  id: string;
  applicationId: string;
  name?: string; // Canonical name e.g. "Aadhaar Card"
  type?: string; // e.g. "identity_document", "education_document", "photo", "signature"
  documentType: string;
  required?: boolean;
  acceptedMimeTypes?: string[];
  maxSizeMB?: number;
  uploadToken: string; // Session-level secure token
  qrDataUrl: string; // Session-level QR data URL
  uploadUrl: string; // Session-level upload URL
  status: DocumentStatus;
  rejectionReason?: string;
  detectedType?: string;
  uploadedFileName?: string;
  fileSizeBytes?: number;
  uploadedAt?: string;
  verifiedAt?: string;
}

export interface CanonicalDocumentRequirement extends DocumentRequirement {
  name: string;
  type: string;
  required: boolean;
}

export interface UploadSession {
  sessionId: string;
  applicationId: string;
  workflowMode: WorkflowMode;
  secureToken: string;
  qrUrl: string;
  qrDataUrl: string;
  requiredDocuments: DocumentRequirement[];
  uploadedDocuments: DocumentRequirement[];
  processingDocuments: DocumentRequirement[];
  verifiedDocuments: DocumentRequirement[];
  rejectedDocuments: DocumentRequirement[];
  failedDocuments: DocumentRequirement[];
  status: 'waiting_documents' | 'processing' | 'ready_for_review' | 'completed';
  createdAt: string;
  expiresAt: string;
}

export interface UploadSessionSummary {
  sessionId: string;
  token: string;
  requiredDocuments: DocumentRequirement[];
  uploadedDocuments: DocumentRequirement[];
  processingDocuments: DocumentRequirement[];
  completedDocuments: DocumentRequirement[];
  rejectedDocuments: DocumentRequirement[];
  failedDocuments: DocumentRequirement[];
  overallStatus: 'waiting_documents' | 'processing' | 'ready_for_review' | 'completed';
  totalRequired: number;
  totalVerified: number;
  isAllVerified: boolean;
}

export interface UploadTokenRecord {
  tokenHash: string;
  rawToken?: string;
  sessionId: string;
  applicationId: string;
  workflowMode?: 'URL_PASTE' | 'EXTENSION_INSPECTION';
  scope?: string;
  formUrl?: string;
  requirementId: string;
  expectedDocumentType: string;
  requiredDocuments?: DocumentRequirement[];
  createdAt: string;
  expiresAt: number;
  consumedAt: string | null;
  status: 'active' | 'consumed' | 'expired';
}

export interface ValidatedTokenInfo {
  tokenHash: string;
  rawToken?: string;
  sessionId: string;
  applicationId: string;
  workflowMode?: 'URL_PASTE' | 'EXTENSION_INSPECTION';
  scope?: string;
  formUrl?: string;
  requirementId: string;
  expectedDocumentType: string;
  requiredDocuments?: DocumentRequirement[];
  createdAt: string;
  expiresAt: number;
  consumedAt: string | null;
  status: 'active' | 'consumed' | 'expired';
  expired: boolean;
  consumed: boolean;
  storageTier?: 'L1_memory' | 'L2_disk' | 'L3_supabase_storage';
}

export interface ExtractedField {
  field: string;
  value: string;
  source: string; // e.g. "10th Marksheet"
  confidence: number; // e.g. 0.98
}

export interface DocumentClassificationResult {
  isMatch: boolean;
  expectedType: string;
  detectedType: string;
  confidence: number;
  reason: string;
  extractedFields: ExtractedField[];
}

export interface FieldMapping {
  id: string;
  source: string; // Document source, e.g. "10th Marksheet" or "Manual Entry"
  extractedValue: string;
  targetField: string;
  targetSelector: string;
  targetId?: string;
  targetName?: string;
  confidence: number;
  status: 'matched' | 'manual_required' | 'attention_required' | 'confirmed' | 'corrected';
  isManualEntry: boolean;
  editedByOperator?: boolean;
}

export type WorkflowMode = 'URL_PASTE' | 'EXTENSION_INSPECTION';

export interface ApplicationSession {
  id: string;
  workflowMode: WorkflowMode;
  url: string;
  pastedUrl?: string; // Mode 1: Exact pasted government form URL
  inspectedUrl?: string; // Mode 2: Exact last-known inspected URL (never truncated to domain)
  pageTitle?: string;
  formActionUrl?: string;
  targetTabId?: number; // Primary handle in Chrome
  targetWindowId?: number;
  targetOrigin?: string;
  inspectedAt?: string;
  inspectionState?: 'active_inspected' | 'lost' | 'fallback_reopened';
  status: 'created' | 'analyzing' | 'waiting_documents' | 'processing' | 'ready_for_review' | 'completed' | 'purged';
  detectedFields: DetectedField[];
  requirements: AnalyzedRequirement[];
  documentRequirements: DocumentRequirement[];
  sessionUploadToken?: string;
  sessionQrDataUrl?: string;
  sessionUploadUrl?: string;
  extractedData: ExtractedField[];
  mappings: FieldMapping[];
  unfilledRequiredFields: string[];
  createdAt: string;
  expiresAt: string;
  storagePurged: boolean;
  purgedAt?: string;
  extensionConnected?: boolean;
}

export interface LearningFeedbackEvent {
  id?: string;
  sessionId?: string;
  formDomain: string;
  formUrlPattern?: string;
  fieldSelector?: string;
  fieldLabel: string;
  fieldName?: string;
  previousMapping?: string;
  correctedMapping?: string;
  aiPredictedMapping?: string;
  operatorConfirmedMapping?: string;
  documentType?: string;
  previousClassification?: string;
  correctedClassification?: string;
  operatorCorrection?: string;
  confidenceBefore?: number;
  confidenceAfter?: number;
  verified?: boolean;
  wasCorrected?: boolean;
  createdAt?: string;
}

export type AIProviderType = 'gemini' | 'openai';

export interface AIProvider {
  name: AIProviderType;
  isAvailable(): boolean;
  analyzeForm(
    fields: DetectedField[],
    formUrl?: string,
    historicalContext?: LearningFeedbackEvent[]
  ): Promise<FormAnalysisResult>;
  classifyAndExtractDocument(
    buffer: Buffer,
    mimeType: string,
    expectedDocType: string,
    historicalContext?: LearningFeedbackEvent[]
  ): Promise<DocumentClassificationResult>;
  mapFields(
    fields: DetectedField[],
    extractedData: ExtractedField[],
    historicalContext?: LearningFeedbackEvent[]
  ): Promise<FieldMapping[]>;
}
