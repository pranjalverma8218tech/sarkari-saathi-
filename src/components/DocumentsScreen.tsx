import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  QrCode,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { DocumentRequirement, ExtractedField } from '../types.js';

interface DocumentsScreenProps {
  formTitle: string;
  documentRequirements: DocumentRequirement[];
  extractedData?: ExtractedField[];
  onProceedToAutoFill: () => void;
  onRefreshSession: () => void;
  isPolling: boolean;
  onManualUpload?: (reqId: string, docType: string, file: File) => Promise<void>;
  onRegenerateQr?: (reqId: string) => Promise<void>;
}

export const DocumentsScreen: React.FC<DocumentsScreenProps> = ({
  formTitle,
  documentRequirements,
  extractedData = [],
  onProceedToAutoFill,
  onRefreshSession,
  isPolling,
  onManualUpload,
  onRegenerateQr,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploadingReqId, setUploadingReqId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

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

  const handleCopyLink = (reqId: string, url: string) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedId(reqId);
    setTimeout(() => setCopiedId(null), 2000);
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

  const handleRegenerate = async (reqId: string) => {
    if (!onRegenerateQr) return;
    setRegeneratingId(reqId);
    try {
      await onRegenerateQr(reqId);
    } finally {
      setRegeneratingId(null);
    }
  };

  return (
    <div id="documents-screen" className="max-w-5xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <div className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full mb-2">
            <QrCode className="w-3.5 h-3.5" />
            <span>Dedicated QR Per Document</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">
            Document Requirements &amp; Secure QR Codes
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Customer scans each document&apos;s specific QR code to upload the required certificate.
          </p>
          <div className="mt-2 text-xs text-slate-500 font-medium">
            Form: <span className="font-semibold text-slate-800">{formTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="btn-refresh-status"
            onClick={onRefreshSession}
            disabled={isPolling}
            className="inline-flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
            <span>{isPolling ? 'Syncing...' : 'Refresh Status'}</span>
          </button>

          {isAllVerified && (
            <button
              onClick={onProceedToAutoFill}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <span>Review Extracted Data</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress & Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white border border-slate-200 rounded-xl p-4 shadow-2xs mb-6">
        <div className="text-center">
          <span className="text-xs text-slate-500 font-medium block">Total Required</span>
          <span className="text-xl font-bold text-slate-900">{totalCount}</span>
        </div>
        <div className="text-center">
          <span className="text-xs text-slate-500 font-medium block">Verified</span>
          <span className="text-xl font-bold text-emerald-600">{verifiedCount}</span>
        </div>
        <div className="text-center">
          <span className="text-xs text-slate-500 font-medium block">Waiting Upload</span>
          <span className="text-xl font-bold text-amber-600">{totalCount - uploadedCount}</span>
        </div>
        <div className="text-center">
          <span className="text-xs text-slate-500 font-medium block">Rejected / Retry</span>
          <span className="text-xl font-bold text-rose-600">{rejectedCount}</span>
        </div>
      </div>

      {/* Overall Verification Status Banner */}
      {isAllVerified ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <h4 className="text-sm font-bold text-emerald-900">
                ✓ All required documents verified
              </h4>
              <p className="text-xs text-emerald-700">
                Extracted data is synchronized with the cyber café workstation and ready for auto-fill.
              </p>
            </div>
          </div>
          <button
            onClick={onProceedToAutoFill}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-5 py-2.5 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <span>Proceed to Review &amp; Auto-Fill</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3.5 mb-6 flex items-center justify-between gap-4">
          <div className="text-xs text-blue-900">
            <span className="font-bold">Verification Progress:</span> {verifiedCount} of {totalCount} verified (
            {totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0}%). Customer can scan the QR codes on the cards below.
          </div>
          <div className="w-36 h-2 bg-blue-100 rounded-full overflow-hidden shrink-0">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-300"
              style={{ width: `${totalCount > 0 ? (verifiedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* List of Document Requirements with Individual Dedicated QR Codes */}
      <div className="space-y-6">
        {documentRequirements.map((doc, idx) => {
          const docTitle = doc.name || doc.documentType || `Document #${idx + 1}`;
          const isVerified = doc.status === 'verified';
          const isRejected = doc.status === 'rejected';
          const isProcessing = doc.status === 'processing' || doc.status === 'uploading';
          const isPending = !isVerified && !isRejected && !isProcessing;

          // Fields extracted from this document
          const docExtractedFields = extractedData.filter(
            (f) =>
              f.source.toLowerCase().trim() === doc.documentType.toLowerCase().trim() ||
              doc.documentType.toLowerCase().includes(f.source.toLowerCase()) ||
              f.source.toLowerCase().includes(doc.documentType.toLowerCase())
          );

          return (
            <div
              key={doc.id}
              id={`doc-card-${doc.id}`}
              className={`bg-white rounded-2xl border transition-all shadow-2xs overflow-hidden ${
                isVerified
                  ? 'border-emerald-200 ring-1 ring-emerald-100'
                  : isRejected
                  ? 'border-rose-200 ring-1 ring-rose-100'
                  : isProcessing
                  ? 'border-blue-300 ring-1 ring-blue-100'
                  : 'border-slate-200'
              }`}
            >
              {/* Card Header */}
              <div className="px-5 py-4 bg-slate-50/70 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm ${
                      isVerified
                        ? 'bg-emerald-100 text-emerald-700'
                        : isRejected
                        ? 'bg-rose-100 text-rose-700'
                        : isProcessing
                        ? 'bg-blue-100 text-blue-700 animate-pulse'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {isVerified ? '✓' : idx + 1}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <span>{docTitle}</span>
                      {doc.type && (
                        <span className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                          {doc.type.replace(/_/g, ' ')}
                        </span>
                      )}
                    </h3>
                    <span className="text-xs text-slate-500">
                      {doc.required !== false ? 'Mandatory Certificate' : 'Optional'}
                    </span>
                  </div>
                </div>

                {/* Status Badge */}
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-full ${
                      isVerified
                        ? 'bg-emerald-100 text-emerald-800'
                        : isRejected
                        ? 'bg-rose-100 text-rose-800'
                        : isProcessing
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {isVerified
                      ? '✓ Verified'
                      : isRejected
                      ? '⚠ Wrong Document'
                      : isProcessing
                      ? 'Analyzing...'
                      : 'Waiting for Upload'}
                  </span>
                </div>
              </div>

              {/* Card Body: Details & Dedicated QR Code */}
              <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                {/* 1. Left Two Columns: Verification & Audit Checklist */}
                <div className="md:col-span-2 space-y-4">
                  {/* Audit Checklist matching User Specification */}
                  <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl p-4 space-y-3">
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Document Pipeline Status
                    </div>

                    {/* Step 1: QR Generated */}
                    <div className="flex items-start gap-2.5 text-xs">
                      <div className="mt-0.5 w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-[10px]">
                        ✓
                      </div>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-800">QR Code: </span>
                        <span className="text-slate-600">
                          Dedicated token generated ({doc.uploadToken ? `${doc.uploadToken.slice(0, 4)}...${doc.uploadToken.slice(-4)}` : 'Active'})
                        </span>
                      </div>
                    </div>

                    {/* Step 2: Upload Status */}
                    <div className="flex items-start gap-2.5 text-xs">
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px] ${
                          isVerified || isProcessing
                            ? 'bg-emerald-100 text-emerald-700'
                            : isRejected
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {isVerified || isProcessing ? '✓' : isRejected ? '✕' : '•'}
                      </div>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-800">Upload Status: </span>
                        {isVerified || isProcessing ? (
                          <span className="text-emerald-700 font-medium">
                            Uploaded {doc.uploadedFileName ? `(${doc.uploadedFileName})` : ''}
                          </span>
                        ) : isRejected ? (
                          <span className="text-rose-700 font-medium">
                            File uploaded was rejected
                          </span>
                        ) : (
                          <span className="text-slate-500">Waiting for customer scan and mobile upload</span>
                        )}
                      </div>
                    </div>

                    {/* Step 3: Verification Status */}
                    <div className="flex items-start gap-2.5 text-xs">
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px] ${
                          isVerified
                            ? 'bg-emerald-100 text-emerald-700'
                            : isRejected
                            ? 'bg-rose-100 text-rose-700'
                            : isProcessing
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {isVerified ? '✓' : isRejected ? '✕' : isProcessing ? '↻' : '•'}
                      </div>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-800">Verification Status: </span>
                        {isVerified ? (
                          <span className="text-emerald-700 font-medium">
                            Verified {doc.detectedType ? `as ${doc.detectedType}` : ''}
                          </span>
                        ) : isRejected ? (
                          <span className="text-rose-700 font-medium">
                            Rejected: {doc.rejectionReason || 'Wrong document type uploaded'}
                          </span>
                        ) : isProcessing ? (
                          <span className="text-blue-700 font-medium">
                            AI performing OCR and document classification...
                          </span>
                        ) : (
                          <span className="text-slate-500">Pending upload</span>
                        )}
                      </div>
                    </div>

                    {/* Step 4: Extracted Data */}
                    <div className="flex items-start gap-2.5 text-xs">
                      <div
                        className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center font-bold text-[10px] ${
                          isVerified
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {isVerified ? '✓' : '•'}
                      </div>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-800">Extracted Data: </span>
                        {isVerified ? (
                          <span className="text-emerald-700 font-medium">
                            {docExtractedFields.length > 0
                              ? `${docExtractedFields.length} fields extracted`
                              : 'Fields extracted & mapped'}
                          </span>
                        ) : (
                          <span className="text-slate-500">Will be extracted automatically once verified</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Extracted Data Table if Verified */}
                  {isVerified && docExtractedFields.length > 0 && (
                    <div className="bg-emerald-50/40 border border-emerald-200/80 rounded-xl p-3.5">
                      <div className="text-xs font-bold text-emerald-900 mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Extracted Fields from {docTitle}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {docExtractedFields.map((field, fIdx) => (
                          <div key={fIdx} className="bg-white border border-emerald-100 rounded-lg p-2">
                            <span className="text-slate-500 block text-[10px] uppercase font-semibold">{field.field}</span>
                            <span className="text-slate-900 font-bold">{field.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Wrong document explanation banner if rejected */}
                  {isRejected && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-900 flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">Wrong Document Uploaded</div>
                        <div className="text-rose-700 mt-0.5">
                          {doc.rejectionReason || `The uploaded document did not match ${docTitle}. Customer can rescan this QR code to upload the correct certificate.`}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Operator Desktop Manual Upload Button */}
                  {onManualUpload && (
                    <div className="pt-2 flex items-center gap-3">
                      <label
                        title="Upload directly from operator computer"
                        className="inline-flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
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
                        <Upload className="w-3.5 h-3.5 text-slate-600" />
                        <span>{uploadingReqId === doc.id ? 'Uploading...' : 'Desktop File Upload'}</span>
                      </label>
                      <span className="text-[11px] text-slate-400">
                        (If customer provided file via pendrive / email)
                      </span>
                    </div>
                  )}
                </div>

                {/* 2. Right Column: Dedicated QR Code for this Document */}
                <div className="flex flex-col items-center bg-slate-50/70 border border-slate-200/80 rounded-xl p-4">
                  <span className="text-xs font-bold text-slate-700 mb-2">
                    QR: {docTitle}
                  </span>

                  {/* QR Image Container */}
                  <div className="w-44 h-44 bg-white border border-slate-200 rounded-xl flex items-center justify-center p-2 shadow-2xs relative">
                    {doc.qrDataUrl ? (
                      <img
                        src={doc.qrDataUrl}
                        alt={`QR code for ${docTitle}`}
                        className="w-full h-full object-contain rounded-lg"
                      />
                    ) : (
                      <div className="text-xs text-slate-400 flex flex-col items-center gap-1.5 text-center">
                        <RefreshCw className="w-5 h-5 animate-spin text-slate-400" />
                        <span>Generating QR...</span>
                      </div>
                    )}

                    {/* Verified Overlay */}
                    {isVerified && (
                      <div className="absolute inset-0 bg-emerald-900/80 backdrop-blur-2xs rounded-xl flex flex-col items-center justify-center text-white p-2 text-center">
                        <CheckCircle2 className="w-9 h-9 text-emerald-400 mb-1" />
                        <span className="text-xs font-bold">Document Verified</span>
                      </div>
                    )}
                  </div>

                  <span className="text-[11px] text-slate-500 mt-2 text-center">
                    Customer scans this QR to upload <strong>{docTitle}</strong>
                  </span>

                  {/* Quick Action Buttons */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 w-full">
                    {doc.uploadUrl && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleCopyLink(doc.id, doc.uploadUrl)}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-700 hover:text-slate-900 bg-white border border-slate-200 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                        >
                          {copiedId === doc.id ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3 text-slate-500" />
                          )}
                          <span>{copiedId === doc.id ? 'Copied' : 'Copy Link'}</span>
                        </button>

                        <a
                          href={doc.uploadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-md transition-colors"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}

                    {onRegenerateQr && (
                      <button
                        type="button"
                        onClick={() => handleRegenerate(doc.id)}
                        disabled={regeneratingId === doc.id}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-800 bg-white border border-slate-200 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                        title="Regenerate QR if expired"
                      >
                        <RefreshCw className={`w-3 h-3 ${regeneratingId === doc.id ? 'animate-spin' : ''}`} />
                        <span>Regen</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">{verifiedCount}</span> of{' '}
          <span className="font-semibold text-slate-900">{totalCount}</span> documents verified.
        </div>

        <button
          id="btn-proceed-autofill"
          onClick={onProceedToAutoFill}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 transition-all cursor-pointer"
        >
          <span>{isAllVerified ? 'Review Extracted Data' : 'Proceed to Auto-Fill Screen'}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
