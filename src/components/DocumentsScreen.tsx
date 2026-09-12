import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { DocumentRequirement } from '../types.js';

interface DocumentsScreenProps {
  formTitle: string;
  documentRequirements: DocumentRequirement[];
  onProceedToAutoFill: () => void;
  onRefreshSession: () => void;
  isPolling: boolean;
}

export const DocumentsScreen: React.FC<DocumentsScreenProps> = ({
  formTitle,
  documentRequirements,
  onProceedToAutoFill,
  onRefreshSession,
  isPolling,
}) => {
  const verifiedCount = documentRequirements.filter((d) => d.status === 'verified').length;
  const totalCount = documentRequirements.length;

  return (
    <div id="documents-screen" className="max-w-4xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-1">
          Required Documents
        </h2>
        <p className="text-sm text-slate-600 max-w-lg mx-auto">
          Customer must scan the designated QR code for each document. The system will verify and reject incorrect uploads.
        </p>
        <div className="mt-2 inline-flex items-center gap-2 text-xs text-slate-500 font-medium">
          <span>Form: {formTitle}</span>
          <span>•</span>
          <button
            onClick={onRefreshSession}
            disabled={isPolling}
            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isPolling ? 'animate-spin' : ''}`} />
            Refresh Status
          </button>
        </div>
      </div>

      {/* Grid of separate QR codes - Strictly one separate QR per document */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-10">
        {documentRequirements.map((doc) => {
          const isVerified = doc.status === 'verified';
          const isRejected = doc.status === 'rejected';

          return (
            <div
              key={doc.id}
              id={`qr-card-${doc.id}`}
              className={`flex flex-col items-center p-5 rounded-xl border bg-white shadow-xs transition-all ${
                isVerified
                  ? 'border-emerald-300 ring-2 ring-emerald-100'
                  : isRejected
                  ? 'border-red-300 ring-2 ring-red-100'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              {/* QR Image Box */}
              <div className="w-52 h-52 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center p-2 mb-3 relative">
                {doc.qrDataUrl ? (
                  <img
                    src={doc.qrDataUrl}
                    alt={`QR for ${doc.documentType}`}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-xs text-slate-400">Generating QR...</div>
                )}

                {isVerified && (
                  <div className="absolute inset-0 bg-emerald-900/60 backdrop-blur-xs rounded-lg flex flex-col items-center justify-center text-white p-3 text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-1" />
                    <span className="text-xs font-bold">Document Verified</span>
                  </div>
                )}
              </div>

              {/* REQUIRED: The document name must ALWAYS be displayed directly below its QR code */}
              <h3 className="text-base font-bold text-slate-900 text-center mb-1">
                {doc.documentType}
              </h3>

              {/* Status Badge */}
              <div className="mt-1 text-xs">
                {isVerified ? (
                  <span className="text-emerald-700 font-semibold bg-emerald-50 px-2.5 py-0.5 rounded-full">
                    ✓ Received & Verified
                  </span>
                ) : isRejected ? (
                  <div className="text-center">
                    <span className="text-red-700 font-semibold bg-red-50 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Wrong Document
                    </span>
                    {doc.rejectionReason && (
                      <p className="text-[11px] text-red-600 mt-1 max-w-[200px] leading-tight">
                        {doc.rejectionReason}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                    Waiting for scan...
                  </span>
                )}
              </div>

              {/* Direct upload link for operator or testing */}
              <a
                href={doc.uploadUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-800 font-medium"
              >
                Open upload page
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          );
        })}
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
          Proceed to Auto-Fill
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
