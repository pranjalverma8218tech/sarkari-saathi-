/**
 * SmartForm AI - AI Orchestration Service
 * Dispatches to active server-side AI provider (Gemini or OpenAI)
 * Seamless fallback, memory/learning feedback integration
 */

import {
  DetectedField,
  DocumentClassificationResult,
  ExtractedField,
  FieldMapping,
  FormAnalysisResult,
  LearningFeedbackEvent,
} from '../types.js';
import { GeminiProvider } from './ai/gemini-provider.js';
import { OpenAIProvider } from './ai/openai-provider.js';
import { AIProvider } from './ai/provider.js';
import { db } from './db.js';

const geminiInstance = new GeminiProvider();
const openaiInstance = new OpenAIProvider();

export function getAIProvider(): AIProvider {
  const configuredProvider = (process.env.AI_PROVIDER || 'gemini').toLowerCase().trim();

  if (configuredProvider === 'openai') {
    if (!openaiInstance.isAvailable()) {
      console.warn(
        '[AI Orchestrator] AI_PROVIDER is set to openai, but OPENAI_API_KEY is not configured. Falling back to Gemini.'
      );
      if (geminiInstance.isAvailable()) {
        return geminiInstance;
      }
      throw new Error('OpenAI provider is not configured. Please set OPENAI_API_KEY.');
    }
    return openaiInstance;
  }

  return geminiInstance;
}

export const ai = {
  getProviderName(): string {
    try {
      return getAIProvider().name;
    } catch {
      return process.env.AI_PROVIDER || 'gemini';
    }
  },

  isProviderConfigured(provider: 'gemini' | 'openai'): boolean {
    if (provider === 'openai') return openaiInstance.isAvailable();
    return geminiInstance.isAvailable();
  },

  /**
   * Real AI Form Analysis: Analyzes the detected DOM form fields and determines
   * required information, required documents, manual fields, and relationships.
   * Feeds historical learning feedback for the target domain into the model context.
   */
  async analyzeForm(
    fields: DetectedField[],
    formUrl = '',
    customContext?: LearningFeedbackEvent[]
  ): Promise<FormAnalysisResult> {
    const provider = getAIProvider();

    let domain = '';
    try {
      if (formUrl && formUrl.startsWith('http')) {
        domain = new URL(formUrl).hostname;
      }
    } catch {
      // ignore
    }

    const context = customContext || db.getRelevantFeedback(domain);
    return provider.analyzeForm(fields, formUrl, context);
  },

  /**
   * Real Multimodal Document Classification & Wrong Document Detection
   * Analyzes the uploaded file (image/PDF) against the expected document type.
   */
  async classifyAndExtractDocument(
    buffer: Buffer,
    mimeType: string,
    expectedDocType: string,
    customContext?: LearningFeedbackEvent[]
  ): Promise<DocumentClassificationResult> {
    const provider = getAIProvider();
    const context = customContext || db.getRelevantFeedback('');
    return provider.classifyAndExtractDocument(buffer, mimeType, expectedDocType, context);
  },

  /**
   * Smart Field Mapping: Maps all extracted document data + manual fields
   * to the actual DOM elements found on the government portal.
   */
  async generateFieldMappings(
    extractedFields: ExtractedField[],
    detectedFormFields: DetectedField[],
    learningFeedback?: LearningFeedbackEvent[]
  ): Promise<FieldMapping[]> {
    const provider = getAIProvider();
    const context = learningFeedback || db.getRelevantFeedback('');
    return provider.generateFieldMappings(extractedFields, detectedFormFields, context);
  },
};
