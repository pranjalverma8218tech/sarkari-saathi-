import React, { useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  FileCheck,
  FileText,
  Lock,
  Upload,
} from 'lucide-react';

interface MobileUploadViewProps {
  sessionId: string;
  token: string;
  docName: string;
}

export const MobileUploadView: React.FC<MobileUploadViewProps> = ({
  sessionId,
  token,
  docName,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    rejected?: boolean;
    message?: string;
    detectedType?: string;
    extractedCount?: number;
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setUploadResult(null);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('session', sessionId);
    formData.append('token', token);
    formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setUploadResult({
          success: true,
          message: `Document verified! Your ${data.detectedType || docName} was successfully processed and sent to the operator.`,
          detectedType: data.detectedType,
          extractedCount: data.extractedCount,
        });
      } else {
        // Wrong document or validation error
        setUploadResult({
          success: false,
          rejected: data.rejected || false,
          detectedType: data.detectedType,
          message:
            data.message ||
            data.error ||
            `Upload rejected. Please ensure you are uploading your ${docName}.`,
        });
      }
    } catch (err: any) {
      setUploadResult({
        success: false,
        message: 'Network error during upload: ' + (err.message || 'Please retry.'),
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-4 sm:p-6">
      <div className="max-w-md w-full mx-auto pt-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-700 mb-3">
            <FileText className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Upload Document</h1>
          <p className="text-xs text-slate-500 mt-1">SmartForm AI Customer Portal</p>
        </div>

        {/* Required Document Specification Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs mb-6">
          <div className="text-center mb-6">
            <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-wider">
              Target Document
            </span>
            <h2 className="text-xl font-bold text-slate-900 mt-2">
              {docName}
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Please upload <strong>ONLY</strong> your original {docName}.
            </p>
          </div>

          {/* Form */}
          {!uploadResult?.success ? (
            <form onSubmit={handleUpload} className="space-y-4">
              <label
                htmlFor="mobile-file-input"
                className={`block border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  selectedFile
                    ? 'border-blue-500 bg-blue-50/50'
                    : 'border-slate-300 hover:border-slate-400 bg-slate-50'
                }`}
              >
                <input
                  id="mobile-file-input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={isUploading}
                />
                <Upload className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                {selectedFile ? (
                  <div>
                    <span className="text-sm font-semibold text-blue-900 block truncate max-w-xs mx-auto">
                      {selectedFile.name}
                    </span>
                    <span className="text-xs text-slate-500 mt-1 block">
                      {(selectedFile.size / 1024).toFixed(1)} KB • Click to change
                    </span>
                  </div>
                ) : (
                  <div>
                    <span className="text-sm font-semibold text-slate-700 block">
                      Choose Certificate / Document
                    </span>
                    <span className="text-xs text-slate-400 mt-1 block">
                      PDF, JPG, JPEG, or PNG (Max 10MB)
                    </span>
                  </div>
                )}
              </label>

              <button
                type="submit"
                disabled={!selectedFile || isUploading}
                className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl text-sm shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    AI Analyzing Document...
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4" />
                    Upload & Verify Document
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">
                Document Verified!
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                {uploadResult.message}
              </p>
              <div className="mt-6 p-3 bg-emerald-50 rounded-xl text-xs text-emerald-800 font-medium">
                You can now return to the cyber café operator. The application form is updating.
              </div>
            </div>
          )}

          {/* Rejection / Feedback Box */}
          {uploadResult && !uploadResult.success && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-left">
              <div className="flex items-start gap-2.5">
                <AlertOctagon className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-xs text-red-800">
                  <span className="font-bold block text-sm mb-1">
                    {uploadResult.rejected ? 'Wrong Document Detected' : 'Upload Rejected'}
                  </span>
                  <p className="leading-relaxed">{uploadResult.message}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Privacy Note */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 text-center">
          <Lock className="w-3.5 h-3.5" />
          <span>Uploaded documents are encrypted and purged after form filling</span>
        </div>
      </div>

      <footer className="text-center text-[11px] text-slate-400 py-4">
        SmartForm AI • Powered by Gemini Multimodal AI
      </footer>
    </div>
  );
};
