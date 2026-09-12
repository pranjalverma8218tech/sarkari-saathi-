import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { FieldMapping } from '../types';
import { autofillForm, focusFormTab, openGovernmentForm } from '../lib/extensionBridge';

interface AutoFillScreenProps {
  sessionId?: string;
  targetTabId?: number;
  targetWindowId?: number;
  mappings: FieldMapping[];
  verifiedDocTypes: string[];
  targetUrl: string;
  onProceedToReview: () => void;
}

export const AutoFillScreen: React.FC<AutoFillScreenProps> = ({
  sessionId,
  targetTabId,
  targetWindowId,
  mappings,
  verifiedDocTypes,
  targetUrl,
  onProceedToReview,
}) => {
  const [isVerifying, setIsVerifying] = useState(true);
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    filledCount: number;
    manualCount: number;
    error?: string;
    message?: string;
  } | null>(null);
  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState<string | null>(null);

  const runAutoFill = async () => {
    setIsVerifying(true);
    setVerificationResult(null);
    setSwitchFeedback(null);

    try {
      const result = await autofillForm({
        sessionId: sessionId || '',
        targetTabId,
        targetWindowId,
        mappings,
      });

      if (result.success) {
        setVerificationResult({
          success: true,
          filledCount: result.filledCount,
          manualCount: result.manualFields ? result.manualFields.length : 0,
          message: result.message,
        });
      } else {
        setVerificationResult({
          success: false,
          filledCount: 0,
          manualCount: mappings.filter((m) => m.isManualEntry).length,
          error: result.message || result.error || 'Live government form tab could not be reached.',
        });
      }
    } catch (err: any) {
      setVerificationResult({
        success: false,
        filledCount: 0,
        manualCount: 0,
        error: err.message || 'Auto-fill communication failed.',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    // Execute real autofill verification
    const timer = setTimeout(() => {
      runAutoFill();
    }, 600);

    return () => clearTimeout(timer);
  }, [sessionId, targetTabId, targetWindowId, mappings]);

  const handleOpenOrSwitchTab = async () => {
    setIsSwitchingTab(true);
    setSwitchFeedback(null);

    try {
      const focusRes = await focusFormTab({
        targetTabId,
        targetWindowId,
        sessionId,
      });

      if (focusRes.success) {
        setSwitchFeedback('Focus switched to live government form tab in Chrome.');
      } else {
        // Try opening the form tab if not currently open
        const openRes = await openGovernmentForm(targetUrl, sessionId);
        if (openRes.success) {
          setSwitchFeedback('Government form tab opened and registered.');
          // Retry autofill
          await runAutoFill();
        } else {
          setSwitchFeedback(
            openRes.message ||
              'Could not reach tab. Ensure SmartForm AI Chrome Extension is loaded in chrome://extensions.'
          );
        }
      }
    } catch (err: any) {
      setSwitchFeedback('Tab navigation error: ' + err.message);
    } finally {
      setIsSwitchingTab(false);
      setTimeout(() => setSwitchFeedback(null), 5000);
    }
  };

  const docLabel = verifiedDocTypes.length > 0 ? verifiedDocTypes.join(', ') : 'Required documents';

  return (
    <div id="autofill-screen" className="max-w-xl mx-auto py-10 px-6 text-center">
      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-6 h-6" />
      </div>

      <h2 className="text-2xl font-bold text-slate-900 mb-2">
        Processing & Live DOM Injection
      </h2>
      <p className="text-sm text-slate-600 mb-6">
        Injecting verified customer data directly into the live government form tab.
      </p>

      {/* Target Tab Context Badge */}
      <div className="mb-6 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 flex flex-col sm:flex-row items-center justify-between gap-2 text-left">
        <div className="truncate max-w-sm">
          <span className="font-semibold text-slate-900">Target Portal: </span>
          <span className="font-mono text-slate-600">{targetUrl}</span>
        </div>
        {targetTabId ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
            Tab ID: {targetTabId}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
            URL-Paste Mode
          </span>
        )}
      </div>

      {/* Verifying Spinner */}
      {isVerifying && (
        <div className="p-8 rounded-xl border border-slate-200 bg-white shadow-xs mb-6 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm font-semibold text-slate-900">
            Delivering data to live government form tab...
          </p>
          <p className="text-xs text-slate-500 max-w-sm">
            Validating tab existence, origin security, and DOM element accessibility before acknowledging.
          </p>
        </div>
      )}

      {/* Verified Success Display */}
      {!isVerifying && verificationResult?.success && (
        <div className="p-6 rounded-xl border border-emerald-200 bg-emerald-50/70 shadow-xs mb-6 text-left">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h3 className="text-base font-bold text-emerald-950">
                Auto-fill Verified
              </h3>
              <p className="text-xs text-emerald-800 leading-relaxed">
                The Chrome extension content script confirmed delivery into the active government form DOM:
              </p>
              <ul className="text-xs space-y-1 font-medium text-emerald-900 list-disc list-inside">
                <li>
                  <strong className="text-emerald-950 font-bold">{verificationResult.filledCount}</strong> fields filled directly into the live form DOM
                </li>
                {verificationResult.manualCount > 0 ? (
                  <li>
                    <strong className="text-amber-900 font-bold">{verificationResult.manualCount}</strong> fields require operator manual entry
                  </li>
                ) : (
                  <li>All extracted document fields matched successfully</li>
                )}
              </ul>
              <p className="text-[11px] text-emerald-700 pt-1">
                Values have been visually highlighted in soft green on the official portal.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Unverified / Connection Pending Display (Honest Status - No False Claims) */}
      {!isVerifying && verificationResult && !verificationResult.success && (
        <div className="p-6 rounded-xl border border-amber-200 bg-amber-50/70 shadow-xs mb-6 text-left">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-2">
              <h3 className="text-base font-bold text-amber-950">
                Government Tab Connection Notice
              </h3>
              <p className="text-xs text-amber-900 leading-relaxed">
                {verificationResult.error}
              </p>
              <p className="text-xs text-slate-600">
                To complete live DOM injection, make sure the SmartForm AI Chrome Extension is active, or click below to open the portal in Chrome.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Banner for Tab Actions */}
      {switchFeedback && (
        <div className="mb-4 p-3 bg-slate-900 text-white text-xs rounded-lg flex items-center justify-between">
          <span>{switchFeedback}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          id="btn-switch-live-tab"
          type="button"
          onClick={handleOpenOrSwitchTab}
          disabled={isSwitchingTab}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700 transition-all cursor-pointer disabled:opacity-50"
        >
          {isSwitchingTab ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ExternalLink className="w-4 h-4" />
          )}
          Open / Switch to Government Form
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runAutoFill}
            disabled={isVerifying}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
            Re-verify Auto-fill
          </button>

          <button
            id="btn-goto-review"
            type="button"
            onClick={onProceedToReview}
            className="grow inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-xs hover:bg-blue-700 transition-all cursor-pointer"
          >
            Review & Verify Fields
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
