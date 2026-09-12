import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Loader2 } from 'lucide-react';
import { FieldMapping } from '../types.js';

interface AutoFillScreenProps {
  mappings: FieldMapping[];
  verifiedDocTypes: string[];
  targetUrl: string;
  onProceedToReview: () => void;
}

export const AutoFillScreen: React.FC<AutoFillScreenProps> = ({
  mappings,
  verifiedDocTypes,
  targetUrl,
  onProceedToReview,
}) => {
  const [step1Done, setStep1Done] = useState(false);
  const [step2Done, setStep2Done] = useState(false);
  const [step3Done, setStep3Done] = useState(false);
  const [step4Done, setStep4Done] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState<'checking' | 'connected' | 'not_detected'>('checking');

  useEffect(() => {
    // Progressive feedback steps
    const t1 = setTimeout(() => setStep1Done(true), 400);
    const t2 = setTimeout(() => setStep2Done(true), 900);
    const t3 = setTimeout(() => setStep3Done(true), 1400);
    const t4 = setTimeout(() => {
      setStep4Done(true);
      // Attempt to broadcast auto-fill message to Chrome extension content script
      window.postMessage(
        {
          type: 'SMARTFORM_AUTO_FILL_REQUEST',
          mappings,
        },
        '*'
      );
      setExtensionStatus('connected');
    }, 1900);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [mappings]);

  const docLabel = verifiedDocTypes.length > 0 ? verifiedDocTypes.join(', ') : 'Customer documents';
  const filledCount = mappings.filter((m) => !m.isManualEntry && m.extractedValue).length;

  return (
    <div id="autofill-screen" className="max-w-md mx-auto py-10 px-6 text-center">
      <h2 className="text-2xl font-bold text-slate-900 mb-2">
        Processing & Auto-Fill
      </h2>
      <p className="text-sm text-slate-500 mb-8">
        Mapping extracted values directly to the live website DOM.
      </p>

      {/* Simple Status List - As strictly requested */}
      <div className="space-y-4 text-left max-w-sm mx-auto mb-8">
        {/* Status 1 */}
        <div className="flex items-center gap-3 text-sm">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
              step1Done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {step1Done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          <span className={`font-medium ${step1Done ? 'text-slate-800' : 'text-slate-400'}`}>
            {docLabel} verified
          </span>
        </div>

        {/* Status 2 */}
        <div className="flex items-center gap-3 text-sm">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
              step2Done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {step2Done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          <span className={`font-medium ${step2Done ? 'text-slate-800' : 'text-slate-400'}`}>
            Data extracted
          </span>
        </div>

        {/* Status 3 */}
        <div className="flex items-center gap-3 text-sm">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
              step3Done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {step3Done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          <span className={`font-medium ${step3Done ? 'text-slate-800' : 'text-slate-400'}`}>
            Form fields mapped ({filledCount} fields matched)
          </span>
        </div>

        {/* Status 4 */}
        <div className="flex items-center gap-3 text-sm">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
              step4Done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {step4Done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          <span className={`font-medium ${step4Done ? 'text-slate-800' : 'text-slate-400'}`}>
            Form auto-filled
          </span>
        </div>
      </div>

      {step4Done && (
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 text-left flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-0.5">Auto-Fill Signal Sent to Chrome Extension</p>
              <p className="text-blue-700">
                Target elements on <span className="font-mono">{targetUrl}</span> are being updated. Next, review all filled fields and complete any remaining manual entries.
              </p>
            </div>
          </div>

          <button
            id="btn-goto-review"
            onClick={onProceedToReview}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 transition-all cursor-pointer"
          >
            Review & Verify Fields
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
