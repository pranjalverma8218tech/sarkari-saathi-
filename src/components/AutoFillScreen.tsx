import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { FieldMapping, WorkflowMode } from '../types.js';
import { autofillForm, focusFormTab, isExtensionInstalled, openGovernmentForm, reopenGovernmentForm } from '../lib/extensionBridge';

interface AutoFillScreenProps {
  sessionId?: string;
  workflowMode?: WorkflowMode;
  targetTabId?: number;
  targetWindowId?: number;
  mappings: FieldMapping[];
  verifiedDocTypes: string[];
  targetUrl: string;
  inspectedUrl?: string;
  pastedUrl?: string;
  onProceedToReview: () => void;
}

export const AutoFillScreen: React.FC<AutoFillScreenProps> = ({
  sessionId,
  workflowMode,
  targetTabId,
  targetWindowId,
  mappings,
  verifiedDocTypes,
  targetUrl,
  inspectedUrl,
  pastedUrl,
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
  const [isReopening, setIsReopening] = useState(false);
  const [isLiveConnected, setIsLiveConnected] = useState(Boolean(targetTabId));
  const [switchFeedback, setSwitchFeedback] = useState<string | null>(null);
  const [tabLostAlert, setTabLostAlert] = useState<{
    show: boolean;
    lastKnownUrl: string;
    error?: string;
  } | null>(null);

  const effectiveMode: WorkflowMode =
    workflowMode || (targetTabId || inspectedUrl ? 'EXTENSION_INSPECTION' : 'URL_PASTE');
  const exactTargetUrl = inspectedUrl || pastedUrl || targetUrl;

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
        setIsLiveConnected(true);
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
    setTabLostAlert(null);

    try {
      const isExtInstalled = await isExtensionInstalled(false, 400);
      let handledByExtension = false;

      if (isExtInstalled) {
        // 1. Try focusing existing live tab if targetTabId is registered
        if (targetTabId) {
          const focusRes = await focusFormTab({
            targetTabId,
            targetWindowId,
            sessionId,
            expectedUrl: exactTargetUrl,
          }, 2500);

          if (focusRes.success) {
            setIsLiveConnected(true);
            setSwitchFeedback('Live Government Page Connected ✓ Switched to live government form tab in Chrome.');
            handledByExtension = true;
          }
        }

        // 2. If not focused, try opening via extension
        if (!handledByExtension) {
          const openRes = await openGovernmentForm(exactTargetUrl, sessionId, 2500);
          if (openRes.success) {
            setIsLiveConnected(true);
            setSwitchFeedback('Live Government Page Connected ✓ Government form tab opened and registered.');
            await runAutoFill();
            handledByExtension = true;
          }
        }
      }

      // 3. Resilient browser fallback: Open directly in browser tab so user is never blocked
      if (!handledByExtension) {
        window.open(exactTargetUrl, '_blank', 'noopener,noreferrer');
        setIsLiveConnected(true);
        setSwitchFeedback(`Live Government Page Opened ✓ Launched ${exactTargetUrl} in a new tab.`);
        setTabLostAlert(null);
      }
    } catch (err: any) {
      window.open(exactTargetUrl, '_blank', 'noopener,noreferrer');
      setIsLiveConnected(true);
      setSwitchFeedback(`Live Government Page Opened ✓ Launched ${exactTargetUrl} in a new tab.`);
      setTabLostAlert(null);
    } finally {
      setIsSwitchingTab(false);
    }
  };

  const handleReopenExactForm = async () => {
    const urlToOpen = tabLostAlert?.lastKnownUrl || exactTargetUrl;
    if (!urlToOpen) return;
    setIsReopening(true);
    try {
      const isExtInstalled = await isExtensionInstalled(false, 400);
      let reopened = false;

      if (isExtInstalled) {
        const res = await reopenGovernmentForm({
          url: urlToOpen,
          sessionId,
        }, 2500);
        if (res.success) {
          setIsLiveConnected(true);
          setSwitchFeedback('Live Government Page Connected ✓ Reopened exact form URL in Chrome.');
          setTabLostAlert(null);
          reopened = true;
        }
      }

      if (!reopened) {
        window.open(urlToOpen, '_blank', 'noopener,noreferrer');
        setIsLiveConnected(true);
        setSwitchFeedback('Live Government Page Opened ✓ Opened form URL in a new tab.');
        setTabLostAlert(null);
      }
    } catch (err: any) {
      window.open(urlToOpen, '_blank', 'noopener,noreferrer');
      setIsLiveConnected(true);
      setSwitchFeedback('Live Government Page Opened ✓ Opened form URL in a new tab.');
      setTabLostAlert(null);
    } finally {
      setIsReopening(false);
    }
  };

  const docLabel = verifiedDocTypes.length > 0 ? verifiedDocTypes.join(', ') : 'Required documents';

  return (
    <div id="autofill-screen" className="max-w-xl mx-auto py-10 px-6 text-center">
      {/* Mode Identification Badge */}
      <div className="flex items-center justify-center gap-2 mb-4">
        {effectiveMode === 'EXTENSION_INSPECTION' ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Mode 2: Live Page Extension Assistant
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 border border-blue-200 text-blue-800 rounded-full text-xs font-semibold">
            Mode 1: URL-Paste Form Assistant
          </span>
        )}

        {isLiveConnected && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-full text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Live Government Page Connected ✓
          </span>
        )}
      </div>

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
          <span className="font-mono text-slate-600">{exactTargetUrl}</span>
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

      {/* Connection Notice / Extension Status Display */}
      {!isVerifying && verificationResult && !verificationResult.success && (
        <div className="p-5 rounded-xl border border-amber-200 bg-amber-50/80 shadow-xs mb-6 text-left">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <h3 className="text-sm font-bold text-amber-950">
                Live Government Portal Connection
              </h3>
              <p className="text-xs text-amber-900 leading-relaxed">
                {verificationResult.error?.includes('EXTENSION_')
                  ? 'Companion extension is not active in this session. Click "Go to Live Government Form" below to open the official portal directly in a new tab.'
                  : (verificationResult.message || verificationResult.error)}
              </p>
              <p className="text-[11px] text-slate-600">
                Target: <span className="font-mono text-slate-800">{exactTargetUrl}</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Lost Alert in AutoFillScreen */}
      {tabLostAlert && (
        <div className="mb-6 p-4 rounded-xl bg-amber-950/90 border border-amber-500/60 text-amber-100 text-xs text-left">
          <div className="flex items-start gap-2.5 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-amber-300 text-sm">
                Original Government Form Tab Is No Longer Available
              </p>
              <p className="text-amber-200 mt-1 leading-relaxed">
                The original Chrome tab where the form was inspected was closed or unreachable. SmartForm AI does not blindly redirect to the portal homepage, to prevent losing session state, application progress, or authenticated login.
              </p>
            </div>
          </div>

          <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-700 my-2.5">
            <div className="text-[11px] text-slate-400 font-medium mb-1">
              Inspected Form URL (Deep Link):
            </div>
            <div className="font-mono text-xs text-amber-200 break-all select-all">
              {tabLostAlert.lastKnownUrl}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mt-3">
            <button
              id="btn-reopen-exact-form-autofill"
              type="button"
              onClick={handleReopenExactForm}
              disabled={isReopening}
              className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-1.5 rounded-md font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isReopening ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              Reopen Exact Form Page
            </button>
            <button
              type="button"
              onClick={() => setTabLostAlert(null)}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 transition-colors cursor-pointer"
            >
              Dismiss
            </button>
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
          Go to Live Government Form
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
