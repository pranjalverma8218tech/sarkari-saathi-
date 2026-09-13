import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  FileCheck,
  FileText,
  Lock,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { DocumentRequirement } from '../types.js';

interface MobileUploadViewProps {
  sessionId: string;
  token: string;
  docName?: string;
}

interface UploadProgressItem {
  status: 'pending' | 'uploading' | 'processing' | 'verified' | 'rejected' | 'failed';
  progress: number;
  fileName?: string;
  fileSize?: number;
  detectedType?: string;
  message?: string;
  rejectionReason?: string;
}

export const MobileUploadView: React.FC<MobileUploadViewProps> = ({
  sessionId,
  token,
}) => {
  const [docRequirements, setDocRequirements] = useState<DocumentRequirement[]>([]);
  const [docStates, setDocStates] = useState<Record<string, UploadProgressItem>>({});
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Fetch session and required documents
  const fetchSessionData = async () => {
    try {
      const res = await fetch(`/upload?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`, {
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.documentRequirements) {
          setDocRequirements(data.documentRequirements);
          setDocStates((prev) => {
            const next = { ...prev };
            data.documentRequirements.forEach((d: DocumentRequirement) => {
              if (!next[d.id] || next[d.id].status !== d.status) {
                next[d.id] = {
                  status: d.status,
                  progress: d.status === 'verified' ? 100 : 0,
                  detectedType: d.detectedType,
                  rejectionReason: d.rejectionReason,
                  fileName: d.uploadedFileName,
                };
              }
            });
            return next;
          });
          setSessionError(null);
        }
      } else if (res.status === 410) {
        setSessionError('This upload link has expired. Please ask the operator for a fresh QR code.');
      } else if (res.status === 403) {
        setSessionError('Invalid or unauthorized upload token.');
      } else {
        setSessionError('Could not load application details. Please verify your connection.');
      }
    } catch (err: any) {
      setSessionError('Network error connecting to SmartForm AI: ' + (err.message || 'Please retry.'));
    } finally {
      setLoadingSession(false);
    }
  };

  useEffect(() => {
    fetchSessionData();
    const interval = setInterval(fetchSessionData, 3000);
    return () => clearInterval(interval);
  }, [sessionId, token]);

  // Client-side image optimization to accelerate uploads on mobile networks
  const optimizeImage = async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/')) return file;
    if (file.size < 1024 * 1024) return file;

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxDim = 2048;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(file);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          0.88
        );
      };
      img.onerror = () => resolve(file);
      img.src = url;
    });
  };

  const handleFileUpload = async (reqId: string, docType: string, file: File) => {
    setDocStates((prev) => ({
      ...prev,
      [reqId]: {
        status: 'uploading',
        progress: 10,
        fileName: file.name,
        fileSize: file.size,
        message: 'Optimizing and uploading...',
      },
    }));

    try {
      const optimizedFile = await optimizeImage(file);

      const formData = new FormData();
      formData.append('session', sessionId);
      formData.append('token', token);
      formData.append('requirementId', reqId);
      formData.append('docType', docType);
      formData.append('file', optimizedFile);

      setDocStates((prev) => ({
        ...prev,
        [reqId]: {
          ...prev[reqId],
          status: 'processing',
          progress: 85,
          message: 'AI Validating & Classifying...',
        },
      }));

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setDocStates((prev) => ({
          ...prev,
          [reqId]: {
            status: 'verified',
            progress: 100,
            detectedType: data.detectedType,
            message: `Verified as ${data.detectedType || docType}`,
          },
        }));

        setDocRequirements((prev) =>
          prev.map((d) => (d.id === reqId ? { ...d, status: 'verified', detectedType: data.detectedType } : d))
        );
      } else if (res.status === 422) {
        const reason = data.reason || data.message || 'File does not match the expected document.';
        setDocStates((prev) => ({
          ...prev,
          [reqId]: {
            status: 'rejected',
            progress: 0,
            rejectionReason: reason,
            message: `Wrong document detected: ${reason}`,
          },
        }));

        setDocRequirements((prev) =>
          prev.map((d) => (d.id === reqId ? { ...d, status: 'rejected', rejectionReason: reason } : d))
        );
      } else {
        setDocStates((prev) => ({
          ...prev,
          [reqId]: {
            status: 'failed',
            progress: 0,
            message: data.error || 'Upload error. Please retry.',
          },
        }));
      }
    } catch (err: any) {
      setDocStates((prev) => ({
        ...prev,
        [reqId]: {
          status: 'failed',
          progress: 0,
          message: 'Network error: ' + (err.message || 'Please retry.'),
        },
      }));
    }
  };

  const totalRequired = docRequirements.length;
  const totalVerified = docRequirements.filter(
    (d) => docStates[d.id]?.status === 'verified' || d.status === 'verified'
  ).length;
  const isAllDone = totalRequired > 0 && totalVerified === totalRequired;

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">Connecting to secure upload portal...</p>
          <p className="text-xs text-slate-400 mt-1">SmartForm AI</p>
        </div>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-sm w-full text-center shadow-xs">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-3">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Upload Portal Notice</h2>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">{sessionError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-4 sm:p-6">
      <div className="max-w-md w-full mx-auto pt-2">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-1.5 bg-blue-100 text-blue-800 text-xs font-semibold px-3 py-1 rounded-full mb-2">
            <Lock className="w-3 h-3" />
            <span>Secure Single QR Upload</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Upload Your Documents</h1>
          <p className="text-xs text-slate-500 mt-1">
            Upload all required documents for your application below. No need to scan again.
          </p>
        </div>

        {/* Progress Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs mb-4">
          <div className="flex items-center justify-between text-xs font-semibold mb-2">
            <span className="text-slate-600">Verification Progress</span>
            <span className={isAllDone ? 'text-emerald-700' : 'text-blue-700'}>
              {totalVerified} of {totalRequired} verified
            </span>
          </div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${isAllDone ? 'bg-emerald-500' : 'bg-blue-600'}`}
              style={{ width: `${totalRequired > 0 ? (totalVerified / totalRequired) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Success Banner */}
        {isAllDone && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-1.5" />
            <h3 className="text-sm font-bold text-emerald-900">All Documents Verified!</h3>
            <p className="text-xs text-emerald-700 mt-1">
              Your documents have been processed and transferred to the cyber café operator.
            </p>
          </div>
        )}

        {/* Document Cards */}
        <div className="space-y-3 mb-6">
          {docRequirements.map((doc) => {
            const state = docStates[doc.id] || { status: doc.status, progress: 0 };
            const isVerified = state.status === 'verified';
            const isRejected = state.status === 'rejected';
            const isUploading = state.status === 'uploading' || state.status === 'processing';

            return (
              <div
                key={doc.id}
                className={`bg-white rounded-xl border p-4 shadow-xs transition-all ${
                  isVerified
                    ? 'border-emerald-300 bg-emerald-50/20'
                    : isRejected
                    ? 'border-red-300 bg-red-50/20'
                    : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">{doc.documentType}</h2>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {isVerified ? (
                        <span className="text-emerald-700 font-medium">
                          ✓ Verified {state.detectedType ? `as ${state.detectedType}` : ''}
                        </span>
                      ) : isRejected ? (
                        <span className="text-red-600 font-medium">Wrong document detected</span>
                      ) : (
                        'Original PDF, JPG, or PNG'
                      )}
                    </p>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      isVerified
                        ? 'bg-emerald-100 text-emerald-800'
                        : isRejected
                        ? 'bg-red-100 text-red-800'
                        : isUploading
                        ? 'bg-blue-100 text-blue-800 animate-pulse'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {isVerified
                      ? 'Verified'
                      : isRejected
                      ? 'Rejected'
                      : isUploading
                      ? 'Processing...'
                      : 'Pending'}
                  </span>
                </div>

                {/* Rejection notice */}
                {isRejected && (
                  <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 mb-3 flex items-start gap-2">
                    <AlertOctagon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">Mismatch:</span>
                      <p className="text-[11px] leading-tight">
                        {state.rejectionReason || 'Uploaded document does not match requirements.'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Upload Control */}
                <div className="flex items-center gap-2 mt-2">
                  <label
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg cursor-pointer transition-all ${
                      isVerified
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : isRejected
                        ? 'bg-red-600 text-white hover:bg-red-700'
                        : isUploading
                        ? 'bg-blue-100 text-blue-700 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                      capture="environment"
                      className="hidden"
                      disabled={isUploading}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileUpload(doc.id, doc.documentType, e.target.files[0]);
                        }
                      }}
                    />
                    {isUploading ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span>AI Analyzing...</span>
                      </>
                    ) : isVerified ? (
                      <>
                        <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Replace Document</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>{isRejected ? 'Upload Correct Document' : 'Take Photo or Upload'}</span>
                      </>
                    )}
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        {/* Privacy Note */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 text-center">
          <Lock className="w-3.5 h-3.5" />
          <span>Documents are encrypted and purged after form filling</span>
        </div>
      </div>

      <footer className="text-center text-[11px] text-slate-400 py-4">
        SmartForm AI • Powered by Gemini Multimodal AI
      </footer>
    </div>
  );
};
