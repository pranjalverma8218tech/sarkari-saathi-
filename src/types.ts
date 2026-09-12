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

export interface DocumentRequirement {
  id: string;
  applicationId: string;
  documentType: string;
  uploadToken: string;
  qrDataUrl: string;
  uploadUrl: string;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  rejectionReason?: string;
  detectedType?: string;
  uploadedFileName?: string;
  fileSizeBytes?: number;
  uploadedAt?: string;
  verifiedAt?: string;
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

export interface ApplicationSession {
  id: string;
  url: string;
  status: 'created' | 'analyzing' | 'waiting_documents' | 'processing' | 'ready_for_review' | 'completed' | 'purged';
  detectedFields: DetectedField[];
  requirements: AnalyzedRequirement[];
  documentRequirements: DocumentRequirement[];
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
  formDomain: string;
  fieldLabel: string;
  fieldName?: string;
  aiPredictedMapping?: string;
  operatorConfirmedMapping: string;
  wasCorrected: boolean;
}
