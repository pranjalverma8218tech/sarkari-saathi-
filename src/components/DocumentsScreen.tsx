import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  FileText,
  QrCode,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { DocumentRequirement } from '../types.js';

interface DocumentsScreenProps {
  formTitle: string;
  documentRequirements: DocumentRequirement[];
  sessionQrDataUrl?: string;
  sessionUploadUrl?: string;
  onProceedToAutoFill: () => void;
  onRefreshSession: () => void;
  isPolling: boolean;
  onManualUpload?: (reqId: string, docType: string, file: File) => Promise<void>;
}

export const DocumentsScreen: React.FC<DocumentsScreenProps> = ({
  formTitle,
  documentRequirements,
  sessionQrDataUrl,
  sessionUploadUrl,
  onProceedToAutoFill,
  onRefreshSession,
  isPolling,
  onManualUpload,
}) => {
  const [copied, setCopied] = useState(false);
  const [uploadingReqId, setUploadingReqId] = useState<string | null>(null);

  // Statistics calculation
  const totalCount = documentRequirements.length;
  const verifiedCount = documentRequirements.filter((d) => d.status === 'verified').length;
  const processingCount = documentRequirements.filter(
    (d) => d.status === 'processing' || d.status === 'uploading'
  ).length;
  const uploadedCount = documentRequirements.filter(
    (d) => d.status === 'verified' || d.status === 'uploaded' || d.status === 'processing'
  ).length;
  const rejectedCount = documentRequirements.filter((d) => d.status === 'rejected').length;

  const isAllVerified = totalCount > 0 && verifiedCount === totalCount;

  // Single QR code fallback
  const singleQrDataUrl = sessionQrDataUrl || documentRequirements[0]?.qrDataUrl || '';
  const singleUploadUrl = sessionUploadUrl || documentRequirements[0]?.uploadUrl || '';

  const urlObj = React.useMemo(() => {
    if (!singleUploadUrl) return null;
    try {
      return new URL(singleUploadUrl);
    } catch {
      return null;
    }
  }, [singleUploadUrl]);

  const parsedToken = urlObj?.searchParams.get('token') || '';
  const maskedToken = parsedToken ? `${parsedToken.slice(0, 4)}...${parsedToken.slice(-4)}` : 'N/A';

  const handleCopyLink = () => {
    if (singleUploadUrl) {
      navigator.clipboard.writeText(singleUploadUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOperatorUpload = async (reqId: string, docType: string, file: File) => {
    if (!onManualUpload) return;
    setUploadingReqId(reqId);
    try {
      await onManualUpload(reqId, docType, file);
    } finally {
      setUploadingReqId(null);
    }
  };

  return (
    <div id="documents-screen" className="max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full mb-2">
          <QrCode className="w-3.5 h-3.5" />
          <span>Single QR Document Transfer</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">
          Scan ONE QR Code
        </h2>
        <p className="text-sm text-slate-600 max-w-lg mx-auto">
          Customer scans this code to upload all required documents from their phone.
        </p>

        <div className="mt-3 inline-flex items-center gap-2 text-xs text-slate-500 font-medium">
          <span className="truncate max-w-xs">Form: {formTitle}</span>
          <span>•</span>
          <button
            onClick={onRefreshSession}
            disabled={isPolling}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 cursor-pointer font-medium"
          >
            <RefreshCw className={`w-3 h-3 ${isPolling ? 'animate-spin' : ''}`} />
            {isPolling ? 'Syncing...' : 'Refresh Status'}
          </button>
        </div>
      </div>

      {/* Hero: SINGLE QR Code Presentation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs mb-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          {/* QR Code Container */}
          <div className="flex flex-col items-center">
            <div className="w-64 h-64 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center p-3 shadow-xs relative">
              {singleQrDataUrl ? (
                <img
                  src={singleQrDataUrl}
                  alt="Single QR Code for all documents"
                  className="w-full h-full object-contain rounded-lg"
                />
              ) : (
                <div className="text-xs text-slate-400 flex flex-col items-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
                  <span>Generating Secure QR...</span>
                </div>
              )}

              {isAllVerified && (
                <div className="absolute inset-0 bg-emerald-900/75 backdrop-blur-xs rounded-2xl flex flex-col items-center justify-center text-white p-4 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-2" />
                  <span className="text-sm font-bold">All Documents Verified!</span>
                  <span className="text-xs text-emerald-200 mt-1">Ready for Auto-Fill</span>
                </div>
              )}
            </div>

            {/* Direct Links */}
            <div className="mt-3 flex items-center gap-2">
              {singleUploadUrl && (
                <>
                  <button
                    onClick={handleCopyLink}
                    className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy URL'}</span>
                  </button>
                  <a
                    href={singleUploadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <span>Open in New Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </>
              )}
            </div>

            {/* Diagnostic Trace Panel (Requirement 7) */}
            {singleUploadUrl && (
              <div className="mt-4 w-full max-w-xs p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-left text-xs space-y-1">
                <div className="flex items-center justify-between font-bold text-slate-700 text-[11px]">
                  <span>QR Session Metadata</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-semibold uppercase">Authoritative</span>
                </div>
                <div className="text-[11px] text-slate-600 truncate">
                  <span className="font-semibold text-slate-800">Session ID:</span>{' '}
                  <code className="text-blue-700">{urlObj?.searchParams.get('session') || documentRequirements[0]?.applicationId || 'N/A'}</code>
                </div>
                <div className="text-[11px] text-slate-600 truncate">
                  <span className="font-semibold text-slate-800">Masked Token:</span>{' '}
                  <code className="text-emerald-700">{maskedToken}</code>
                </div>
                <div className="text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-800">Datastore:</span>{' '}
                  <span className="text-slate-700">Supabase Storage</span>
                </div>
                <div className="text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-800">Scope:</span>{' '}
                  <span className="text-slate-700">SESSION_ALL_DOCS</span>
                </div>
              </div>
            )}
          </div>

          {/* Metrics & Instructions */}
          <div className="flex-1 w-full flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600">
                Single Session Access
              </span>
              <h3 className="text-xl font-bold text-slate-900 mt-1 mb-2">
                One Scan for All Documents
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed mb-6">
                Direct the applicant to scan the QR code with their mobile phone camera. The customer will be able to select, photograph, and upload all required certificates without scanning separate QR codes.
              </p>
            </div>

            {/* Metrics Dashboard */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200/80 rounded-xl p-4 mb-4">
              <div className="text-center">
                <span className="text-xs text-slate-500 font-medium block">Documents Required</span>
                <span className="text-xl font-bold text-slate-900">{totalCount}</span>
              </div>
              <div className="text-center">
                <span className="text-xs text-slate-500 font-medium block">Uploaded</span>
                <span className="text-xl font-bold text-blue-600">{uploadedCount}</span>
              </div>
              <div className="text-center">
                <span className="text-xs text-slate-500 font-medium block">Verified</span>
                <span className="text-xl font-bold text-emerald-600">{verifiedCount}</span>
              </div>
              <div className="text-center">
                <span className="text-xs text-slate-500 font-medium block">Processing</span>
                <span className={`text-xl font-bold ${processingCount > 0 ? 'text-amber-600 animate-pulse' : 'text-slate-400'}`}>
                  {processingCount}
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold text-slate-700">
                <span>Verification Progress</span>
                <span>{verifiedCount} of {totalCount} verified ({totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0}%)</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${isAllVerified ? 'bg-emerald-500' : 'bg-blue-600'}`}
                  style={{ width: `${totalCount > 0 ? (verifiedCount / totalCount) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Completion Banner */}
      {isAllVerified && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <h4 className="text-sm font-bold text-emerald-900">
                ✓ All required documents processed
              </h4>
              <p className="text-xs text-emerald-700">
                Data fields have been extracted from all documents and are ready for field mapping review.
              </p>
            </div>
          </div>
          <button
            onClick={onProceedToAutoFill}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg shadow-xs transition-colors cursor-pointer shrink-0"
          >
            <span>Review Extracted Data</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Required Documents Detailed List */}
      <div className="mb-8">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">
          Documents Checklist ({totalCount})
        </h3>

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden shadow-xs">
          {documentRequirements.map((doc) => {
            const isVerified = doc.status === 'verified';
            const isRejected = doc.status === 'rejected';
            const isProcessing = doc.status === 'processing' || doc.status === 'uploading';

            return (
              <div
                key={doc.id}
                id={`doc-row-${doc.id}`}
                className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                  isVerified
                    ? 'bg-emerald-50/10'
                    : isRejected
                    ? 'bg-red-50/15'
                    : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                      isVerified
                        ? 'bg-emerald-100 text-emerald-700'
                        : isRejected
                        ? 'bg-red-100 text-red-700'
                        : isProcessing
                        ? 'bg-blue-100 text-blue-700 animate-pulse'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <FileText className="w-5 h-5" />
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{doc.documentType}</h4>
                    {isVerified ? (
                      <div className="text-xs text-emerald-700 flex items-center gap-2 mt-0.5">
                        <span className="font-semibold">✓ Verified</span>
                        {doc.detectedType && <span>• {doc.detectedType}</span>}
                        {doc.uploadedFileName && <span className="text-slate-400">• {doc.uploadedFileName}</span>}
                      </div>
                    ) : isRejected ? (
                      <div className="text-xs text-red-600 mt-0.5">
                        <span className="font-semibold">✕ Wrong Document:</span>{' '}
                        {doc.rejectionReason || 'Uploaded file did not match the document requirements.'}
                      </div>
                    ) : isProcessing ? (
                      <div className="text-xs text-blue-600 mt-0.5 flex items-center gap-1.5 font-medium">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>AI validating and extracting fields...</span>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500 mt-0.5">
                        Waiting for customer upload via phone
                      </div>
                    )}
                  </div>
                </div>

                {/* Status Badges & Operator Desktop Upload Fallback */}
                <div className="flex items-center gap-2 self-end sm:self-center">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      isVerified
                        ? 'bg-emerald-100 text-emerald-800'
                        : isRejected
                        ? 'bg-red-100 text-red-800'
                        : isProcessing
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isVerified
                      ? 'Verified'
                      : isRejected
                      ? 'Needs Review'
                      : isProcessing
                      ? 'Processing'
                      : 'Pending'}
                  </span>

                  {/* Desktop Upload button for cyber café operator if customer brings files via USB */}
                  {onManualUpload && (
                    <label
                      title="Upload directly from operator computer"
                      className="inline-flex items-center gap-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                    >
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                        className="hidden"
                        disabled={uploadingReqId === doc.id}
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleOperatorUpload(doc.id, doc.documentType, e.target.files[0]);
                          }
                        }}
                      />
                      <Upload className="w-3 h-3 text-slate-500" />
                      <span>{uploadingReqId === doc.id ? 'Uploading...' : 'Desktop Upload'}</span>
                    </label>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-200">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{verifiedCount}</span> of{' '}
          <span className="font-semibold text-slate-900">{totalCount}</span> documents verified.
        </div>

        <button
          id="btn-proceed-autofill"
          onClick={onProceedToAutoFill}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 transition-all cursor-pointer"
        >
          {isAllVerified ? 'Review Extracted Data' : 'Proceed to Review & Auto-Fill'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
