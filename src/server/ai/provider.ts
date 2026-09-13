/**
 * SmartForm AI - AI Provider Interface
 * Abstraction layer supporting Gemini, OpenAI, and future models
 */

import {
  DetectedField,
  DocumentClassificationResult,
  ExtractedField,
  FieldMapping,
  FormAnalysisResult,
  LearningFeedbackEvent,
} from '../../types.js';

export interface AIProvider {
  name: 'gemini' | 'openai';
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
  generateFieldMappings(
    extractedFields: ExtractedField[],
    detectedFormFields: DetectedField[],
    learningFeedback?: LearningFeedbackEvent[]
  ): Promise<FieldMapping[]>;
}
