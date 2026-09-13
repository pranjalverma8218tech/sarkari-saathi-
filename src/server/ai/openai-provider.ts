/**
 * SmartForm AI - OpenAI Provider
 * Server-side AI integration using OpenAI REST API
 */

import {
  DetectedField,
  DocumentClassificationResult,
  ExtractedField,
  FieldMapping,
  FormAnalysisResult,
  LearningFeedbackEvent,
} from '../../types.js';
import { AIProvider } from './provider.js';

export class OpenAIProvider implements AIProvider {
  public readonly name = 'openai' as const;

  public isAvailable(): boolean {
    const key = process.env.OPENAI_API_KEY;
    return !!key && key !== 'MY_OPENAI_API_KEY' && key.trim().length > 0;
  }

  private getApiKey(): string {
    const key = process.env.OPENAI_API_KEY;
    if (!key || key === 'MY_OPENAI_API_KEY') {
      throw new Error('OpenAI provider is not configured. Please configure OPENAI_API_KEY in the environment.');
    }
    return key.trim();
  }

  private async callOpenAI(messages: any[], responseJson = true): Promise<any> {
    const apiKey = this.getApiKey();
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    const payload: any = {
      model,
      messages,
      temperature: 0.1,
    };

    if (responseJson) {
      payload.response_format = { type: 'json_object' };
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API request failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty response.');
    }
    return responseJson ? JSON.parse(content) : content;
  }

  async analyzeForm(
    fields: DetectedField[],
    formUrl = '',
    historicalContext: LearningFeedbackEvent[] = []
  ): Promise<FormAnalysisResult> {
    const feedbackBlock =
      historicalContext.length > 0
        ? `\nHISTORICAL VERIFIED OPERATOR CORRECTIONS:
${JSON.stringify(historicalContext.slice(-10), null, 2)}\n`
        : '';

    const prompt = `You are an expert government form analysis AI assistant for cyber café operators.
Analyze the following list of actual form fields detected from government application portal URL: "${formUrl}".
${feedbackBlock}
FIELDS DETECTED:
${JSON.stringify(fields, null, 2)}

Return a JSON object strictly matching this schema:
{
  "formTitle": "Title of the form",
  "summary": "Brief summary",
  "requiredDocuments": ["Aadhaar Card", "10th Marksheet", "Passport Photograph", "Signature"],
  "fieldRequirements": [
    {
      "fieldKey": "candidate_name",
      "targetFieldIdOrName": "name",
      "label": "Candidate Name",
      "required": true,
      "obtainableFromDocument": true,
      "sourceDocumentType": "10th Marksheet",
      "isManualEntry": false,
      "notes": "Extract from marksheet"
    }
  ]
}`;

    const messages = [
      {
        role: 'system',
        content: 'You are a strict AI form analyzer. Return valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ];

    const result = await this.callOpenAI(messages, true);
    if (!result.requiredDocuments || result.requiredDocuments.length === 0) {
      result.requiredDocuments = [
        'Aadhaar Card',
        'High School Marksheet',
        'Intermediate Marksheet',
        'Graduation Marksheet',
        'Photograph',
        'Signature',
        'Caste Certificate',
        'Income Certificate',
      ];
    }
    return result as FormAnalysisResult;
  }

  async classifyAndExtractDocument(
    buffer: Buffer,
    mimeType: string,
    expectedDocType: string,
    historicalContext: LearningFeedbackEvent[] = []
  ): Promise<DocumentClassificationResult> {
    const base64Data = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const prompt = `CRITICAL TASK: DOCUMENT VERIFICATION AND DATA EXTRACTION FOR CYBER CAFÉ.
Expected Document Type: "${expectedDocType}"

Examine this uploaded document.
Determine:
1. Does it match "${expectedDocType}"?
2. If wrong document, set isMatch: false, detectedType to what it is, and provide a clear reason.
3. If correct, set isMatch: true, detectedType: "${expectedDocType}", confidence: 0.98, and extract visible fields into extractedFields.

Return JSON matching:
{
  "isMatch": true or false,
  "expectedType": "${expectedDocType}",
  "detectedType": "detected type string",
  "confidence": 0.98,
  "reason": "explanation message",
  "extractedFields": [
    { "field": "candidate_name", "value": "ROHAN SHARMA", "source": "${expectedDocType}", "confidence": 0.95 }
  ]
}`;

    const messages = [
      {
        role: 'system',
        content: 'You are a strict document auditor. Return JSON only.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: dataUrl },
          },
        ],
      },
    ];

    return (await this.callOpenAI(messages, true)) as DocumentClassificationResult;
  }

  async generateFieldMappings(
    extractedFields: ExtractedField[],
    detectedFormFields: DetectedField[],
    learningFeedback: LearningFeedbackEvent[] = []
  ): Promise<FieldMapping[]> {
    const prompt = `Match extracted document data to actual form input fields.
EXTRACTED FIELDS:
${JSON.stringify(extractedFields, null, 2)}

TARGET DOM FIELDS:
${JSON.stringify(detectedFormFields, null, 2)}

PREVIOUS OPERATOR CORRECTIONS:
${JSON.stringify(learningFeedback, null, 2)}

Return a JSON object with a key "mappings" containing an array of:
{
  "id": "map_0",
  "source": "Document name or Manual Entry",
  "extractedValue": "value",
  "targetField": "Field label",
  "targetSelector": "CSS selector",
  "targetId": "id",
  "targetName": "name",
  "confidence": 0.95,
  "status": "matched" or "manual_required",
  "isManualEntry": false
}`;

    const messages = [
      { role: 'system', content: 'You are a semantic form mapping engine. Return valid JSON.' },
      { role: 'user', content: prompt },
    ];

    const res = await this.callOpenAI(messages, true);
    return (res.mappings || res) as FieldMapping[];
  }
}
