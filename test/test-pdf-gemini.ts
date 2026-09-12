import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

async function testPdfGemini() {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // 1. Create a real valid 12th marksheet PDF
  const wrongPdfDoc = await PDFDocument.create();
  const timesFont = await wrongPdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await wrongPdfDoc.embedFont(StandardFonts.Helvetica);

  const page1 = wrongPdfDoc.addPage([600, 800]);
  page1.drawText('CENTRAL BOARD OF SECONDARY EDUCATION', { x: 50, y: 750, size: 16, font: timesFont, color: rgb(0, 0, 0.6) });
  page1.drawText('ALL INDIA SENIOR SCHOOL CERTIFICATE EXAMINATION 2024', { x: 50, y: 720, size: 13, font: timesFont });
  page1.drawText('MARKS STATEMENT - HIGHER SECONDARY (CLASS XII / 12TH STANDARD)', { x: 50, y: 690, size: 12, font: timesFont, color: rgb(0.8, 0, 0) });
  page1.drawText('Roll No: 1289402', { x: 50, y: 650, size: 11, font: regularFont });
  page1.drawText('Candidate Name: ROHIT SHARMA', { x: 50, y: 630, size: 11, font: regularFont });
  page1.drawText("Father's Name: MANOHAR SHARMA", { x: 50, y: 610, size: 11, font: regularFont });
  page1.drawText('Subject Marks: English 88, Physics 85, Chemistry 90, Mathematics 95', { x: 50, y: 580, size: 11, font: regularFont });
  page1.drawText('Result: PASSED IN FIRST DIVISION (12TH CLASS)', { x: 50, y: 550, size: 11, font: timesFont });

  const wrongPdfBytes = await wrongPdfDoc.save();
  const base64Data = Buffer.from(wrongPdfBytes).toString('base64');

  const expectedDocType = '10th Marksheet';
  const prompt = `CRITICAL TASK: DOCUMENT VERIFICATION AND DATA EXTRACTION FOR CYBER CAFÉ OPERATOR.
Expected Document Type: "${expectedDocType}"
Analyze this document. If it is 12th Marksheet when 10th was expected, set isMatch: false, detectedType: "12th Marksheet". If correct, set isMatch: true.`;

  for (const model of ['gemini-flash-latest', 'gemini-3.8-flash']) {
    try {
      console.log(`Testing model: ${model}...`);
      const response = await client.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data,
              },
            },
            { text: prompt },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isMatch: { type: Type.BOOLEAN },
              detectedType: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              reason: { type: Type.STRING },
            },
            required: ['isMatch', 'detectedType', 'confidence', 'reason'],
          },
        },
      });

      console.log(`${model} SUCCESS:`, response.text);
      break;
    } catch (e: any) {
      console.log(`${model} FAILED:`, e.message || e.status);
    }
  }
}

testPdfGemini().catch(console.error);
