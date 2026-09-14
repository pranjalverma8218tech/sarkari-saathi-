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
  Zap,
} from 'lucide-react';
import { FieldMapping, WorkflowMode } from '../types.js';
import {
  autofillForm,
  focusFormTab,
  openGovernmentForm,
  reopenGovernmentForm,
  useExtensionConnection,
} from '../lib/extensionBridge';

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
  targetTabId: initialTabId,
  targetWindowId: initialWindowId,
  mappings,
  verifiedDocTypes,
  targetUrl,
  inspectedUrl,
  pastedUrl,
  onProceedToReview,
}) => {
  const {
    isExtensionConnected,
    version,
    isTargetTabConnected: bridgeTargetTabConnected,
    targetTabId: bridgeTabId,
    targetTabWindowId: bridgeWindowId,
    checkConnection,
  } = useExtensionConnection();

  const [activeTabId, setActiveTabId] = useState<number | undefined>(initialTabId);
  const [activeWindowId, setActiveWindowId] = useState<number | undefined>(initialWindowId);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    filledCount: number;
    filledFields: string[];
    manualCount: number;
    manualFields: string[];
    error?: string;
    message?: string;
  } | null>(null);

  const [isSwitchingTab, setIsSwitchingTab] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState<string | null>(null);
  const [tabLostAlert, setTabLostAlert] = useState<{
    show: boolean;
    lastKnownUrl: string;
    error?: string;
  } | null>(null);

  // Sync tab IDs from bridge if detected
  useEffect(() => {
    if (bridgeTabId && bridgeTabId !== activeTabId) {
      setActiveTabId(bridgeTabId);
    }
    if (bridgeWindowId && bridgeWindowId !== activeWindowId) {
      setActiveWindowId(bridgeWindowId);
    }
  }, [bridgeTabId, bridgeWindowId]);

  const effectiveTabId = activeTabId || bridgeTabId;
  const isTargetTabConnected = Boolean(effectiveTabId) || bridgeTargetTabConnected;
  const isReadyForAutoFill = isExtensionConnected && isTargetTabConnected;

  const effectiveMode: WorkflowMode =
    workflowMode || (effectiveTabId || inspectedUrl ? 'EXTENSION_INSPECTION' : 'URL_PASTE');
  const exactTargetUrl = inspectedUrl || pastedUrl || targetUrl;

  const runAutoFill = async () => {
    setIsVerifying(true);
    setVerificationResult(null);
    setSwitchFeedback(null);

    try {
      const result = await autofillForm({
        sessionId: sessionId || '',
        targetTabId: effectiveTabId,
        targetWindowId: activeWindowId || bridgeWindowId || undefined,
        mappings,
      });

      if (result.success) {
        setVerificationResult({
          success: true,
          filledCount: result.filledCount,
          filledFields: result.filledFields || [],
          manualCount: result.manualFields ? result.manualFields.length : 0,
          manualFields: result.manualFields || [],
          message: result.message || `Successfully populated ${result.filledCount} fields in the live government form.`,
        });
      } else {
        setVerificationResult({
          success: false,
          filledCount: 0,
          filledFields: [],
          manualCount: mappings.filter((m) => m.isManualEntry).length,
          manualFields: mappings.filter((m) => m.isManualEntry).map((m) => m.targetField),
          error: result.message || result.error || 'Live government form tab could not be reached.',
        });
      }
    } catch (err: any) {
      setVerificationResult({
        success: false,
        filledCount: 0,
        filledFields: [],
        manualCount: 0,
        manualFields: [],
        error: err.message || 'Auto-fill communication failed.',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  // If already in Mode 2 (target tab already known), auto-run autofill
  useEffect(() => {
    if (isReadyForAutoFill && !verificationResult && !isVerifying) {
      const timer = setTimeout(() => {
        runAutoFill();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isReadyForAutoFill]);

  const handleOpenOrSwitchTab = async () => {
    setIsSwitchingTab(true);
    setSwitchFeedback(null);
    setTabLostAlert(null);

    try {
      // 1. If targetTabId already known, focus existing tab
      if (effectiveTabId) {
        const focusRes = await focusFormTab({
          targetTabId: effectiveTabId,
          targetWindowId: activeWindowId || bridgeWindowId || undefined,
          sessionId,
          expectedUrl: exactTargetUrl,
        }, 3000);

        if (focusRes.success) {
          setSwitchFeedback('Live Government Page Connected ✓ Focused form tab in Chrome.');
          setIsSwitchingTab(false);
          return;
        }
      }

      // 2. Open via extension bridge (launches tab, detects content script TAB_READY)
      const openRes = await openGovernmentForm(exactTargetUrl, sessionId, 5000);
      if (openRes.success && openRes.tabId) {
        setActiveTabId(openRes.tabId);
        if (openRes.windowId) setActiveWindowId(openRes.windowId);
        setSwitchFeedback('Target Tab Connected ✓ Government form tab opened and registered.');
        // Trigger auto-fill now that target tab is connected
        setTimeout(() => {
          runAutoFill();
        }, 400);
      } else {
        setSwitchFeedback(`Form opened in Chrome. Waiting for extension to register tab...`);
      }
    } catch (err: any) {
      window.open(exactTargetUrl, '_blank', 'noopener,noreferrer');
      setSwitchFeedback(`Live Government Page Opened ✓ Launched ${exactTargetUrl} in new tab.`);
    } finally {
      setIsSwitchingTab(false);
    }
  };

  const handleReopenExactForm = async () => {
    const urlToOpen = tabLostAlert?.lastKnownUrl || exactTargetUrl;
    if (!urlToOpen) return;
    setIsReopening(true);
    try {
      const res = await reopenGovernmentForm({
        url: urlToOpen,
        sessionId,
      }, 3500);
      if (res.success && res.tabId) {
        setActiveTabId(res.tabId);
        setSwitchFeedback('Live Government Page Connected ✓ Reopened exact form URL in Chrome.');
        setTabLostAlert(null);
      } else {
        window.open(urlToOpen, '_blank', 'noopener,noreferrer');
        setSwitchFeedback('Live Government Page Opened ✓ Opened form URL in a new tab.');
        setTabLostAlert(null);
      }
    } catch (err: any) {
      window.open(urlToOpen, '_blank', 'noopener,noreferrer');
      setSwitchFeedback('Live Government Page Opened ✓ Opened form URL in a new tab.');
      setTabLostAlert(null);
    } finally {
      setIsReopening(false);
    }
  };

  return (
    <div id="autofill-screen" className="max-w-xl mx-auto py-8 px-6 text-center">
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

        {isTargetTabConnected && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-full text-xs font-bold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Target Tab Connected ✓
          </span>
        )}
      </div>

      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-6 h-6" />
      </div>

      <h2 className="text-2xl font-bold text-slate-900 mb-2">
        Live Government DOM Auto-Fill
      </h2>
      <p className="text-sm text-slate-600 mb-6">
        Companion Chrome Extension establishes a secure handshake with the government portal tab and injects verified customer details.
      </p>

      {/* Target Portal Badge */}
      <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700 flex flex-col sm:flex-row items-center justify-between gap-2 text-left">
        <div className="truncate max-w-sm">
          <span className="font-semibold text-slate-900">Target Portal: </span>
          <span className="font-mono text-slate-600">{exactTargetUrl}</span>
        </div>
        {effectiveTabId ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-medium">
            Tab #{effectiveTabId}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-medium">
            Waiting for Tab Launch
          </span>
        )}
      </div>

      {/* Visible Handshake Connection Status (Requirement 9) */}
      <div className="mb-6 p-4 rounded-xl border border-slate-200 bg-white shadow-xs text-left">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Connection Handshake Status
          </span>
          <button
            type="button"
            onClick={() => checkConnection()}
            className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold cursor-pointer inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            Check Handshake
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Status 1: Extension Status */}
          <div
            id="status-extension"
            className={`p-2.5 rounded-lg border flex items-center gap-2.5 transition-colors ${
              isExtensionConnected
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/70 border-amber-200 text-amber-950'
            }`}
          >
            {isExtensionConnected ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <Loader2 className="w-4 h-4 text-amber-600 animate-spin shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-[10px] font-medium opacity-70 uppercase tracking-wider">Extension</div>
              <div className="text-xs font-bold truncate">
                {isExtensionConnected ? `Extension Connected ✓` : 'Waiting for Extension'}
              </div>
            </div>
          </div>

          {/* Status 2: Target Tab Status */}
          <div
            id="status-target-tab"
            className={`p-2.5 rounded-lg border flex items-center gap-2.5 transition-colors ${
              isTargetTabConnected
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            {isTargetTabConnected ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-[10px] font-medium opacity-70 uppercase tracking-wider">Government Tab</div>
              <div className="text-xs font-bold truncate">
                {isTargetTabConnected ? 'Target Tab Connected ✓' : 'Waiting for Target Tab'}
              </div>
            </div>
          </div>

          {/* Status 3: Auto-Fill Ready */}
          <div
            id="status-autofill-ready"
            className={`p-2.5 rounded-lg border flex items-center gap-2.5 transition-colors ${
              isReadyForAutoFill
                ? 'bg-blue-50/70 border-blue-200 text-blue-950'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}
          >
            <Sparkles
              className={`w-4 h-4 shrink-0 ${isReadyForAutoFill ? 'text-blue-600' : 'text-slate-400'}`}
            />
            <div className="min-w-0">
              <div className="text-[10px] font-medium opacity-70 uppercase tracking-wider">Auto-Fill Status</div>
              <div className="text-xs font-bold truncate">
                {isReadyForAutoFill ? 'Ready for Auto-Fill ⚡' : 'Waiting for Tab'}
              </div>
            </div>
          </div>
        </div>

        {/* Guidance tip if extension is not connected yet */}
        {!isExtensionConnected && (
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-start gap-2 text-[11px] text-amber-800">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              Companion Chrome extension is waiting to handshake. Ensure the extension is loaded/reloaded in{' '}
              <code className="bg-amber-100 px-1 py-0.5 rounded font-mono text-[10px]">chrome://extensions</code>{' '}
              with Developer Mode enabled.
            </div>
          </div>
        )}
      </div>

      {/* Verifying / Injecting Spinner */}
      {isVerifying && (
        <div className="p-8 rounded-xl border border-blue-200 bg-white shadow-xs mb-6 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="text-sm font-semibold text-slate-900">
            Delivering data to live government form tab...
          </p>
          <p className="text-xs text-slate-500 max-w-sm">
            Executing non-intrusive native DOM setters and synthetic input events on controlled fields.
          </p>
        </div>
      )}

      {/* Verified Success Display */}
      {!isVerifying && verificationResult?.success && (
        <div className="p-6 rounded-xl border border-emerald-200 bg-emerald-50/80 shadow-xs mb-6 text-left">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-2 flex-1">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-emerald-950">
                  Auto-fill Verified ✓
                </h3>
                <span className="text-[11px] font-bold bg-emerald-200/70 text-emerald-900 px-2.5 py-0.5 rounded-full">
                  DOM Injected
                </span>
              </div>
              <p className="text-xs text-emerald-800 leading-relaxed">
                The Chrome extension content script confirmed delivery directly into the active government form DOM:
              </p>
              <ul className="text-xs space-y-1 font-medium text-emerald-900 list-disc list-inside">
                <li>
                  <strong className="text-emerald-950 font-bold">{verificationResult.filledCount}</strong> fields filled directly into the live form DOM
                </li>
                {verificationResult.filledFields && verificationResult.filledFields.length > 0 && (
                  <li className="list-none pl-4 text-[11px] text-emerald-700">
                    Populated: {verificationResult.filledFields.join(', ')}
                  </li>
                )}
                {verificationResult.manualCount > 0 && (
                  <li>
                    <strong className="text-amber-900 font-bold">{verificationResult.manualCount}</strong> fields require operator manual interaction
                  </li>
                )}
              </ul>
              <p className="text-[11px] text-emerald-700 pt-1">
                Inputs have been visually highlighted in soft green on the official portal for operator verification.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Unsuccessful Result / Action Needed */}
      {!isVerifying && verificationResult && !verificationResult.success && (
        <div className="p-5 rounded-xl border border-amber-200 bg-amber-50/90 shadow-xs mb-6 text-left">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1.5 flex-1">
              <h3 className="text-sm font-bold text-amber-950">
                Live Government Portal Connection Needed
              </h3>
              <p className="text-xs text-amber-900 leading-relaxed">
                {verificationResult.error}
              </p>
              <p className="text-[11px] text-slate-600">
                Click <strong>"Go to Live Government Form"</strong> below to open or target the form tab in Chrome.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Lost Alert */}
      {tabLostAlert && (
        <div className="mb-6 p-4 rounded-xl bg-amber-950/90 border border-amber-500/60 text-amber-100 text-xs text-left">
          <div className="flex items-start gap-2.5 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-amber-300 text-sm">
                Original Government Form Tab Is No Longer Available
              </p>
              <p className="text-amber-200 mt-1 leading-relaxed">
                The original Chrome tab where the form was inspected was closed or unreachable. SmartForm AI does not blindly redirect to the portal homepage, to prevent losing application progress.
              </p>
            </div>
          </div>

          <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-700 my-2.5">
            <div className="text-[11px] text-slate-400 font-medium mb-1">
              Inspected Form URL:
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
        <div className="mb-4 p-3 bg-slate-900 text-white text-xs rounded-lg flex items-center justify-between text-left">
          <span>{switchFeedback}</span>
        </div>
      )}

      {/* Primary Actions */}
      <div className="flex flex-col gap-3">
        {/* Step 1: Open/Connect Tab Button (Prominent when tab is not yet connected) */}
        {!isTargetTabConnected ? (
          <button
            id="btn-switch-live-tab"
            type="button"
            onClick={handleOpenOrSwitchTab}
            disabled={isSwitchingTab}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3.5 text-sm font-bold text-white shadow-xs hover:bg-emerald-700 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSwitchingTab ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4" />
            )}
            Go to Live Government Form
          </button>
        ) : (
          /* Step 2: Auto-Fill Button (Active and enabled once target tab is connected) */
          <button
            id="btn-autofill-now"
            type="button"
            onClick={runAutoFill}
            disabled={isVerifying || !isReadyForAutoFill}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-xs hover:bg-blue-700 transition-all cursor-pointer disabled:opacity-50"
          >
            {isVerifying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 fill-white" />
            )}
            {verificationResult?.success ? 'Re-Inject Verified Data Into Form' : 'Auto-Fill Into Live Tab'}
          </button>
        )}

        {/* Secondary Row: Switch Tab & Review */}
        <div className="flex items-center gap-2">
          {isTargetTabConnected && (
            <button
              id="btn-switch-tab-secondary"
              type="button"
              onClick={handleOpenOrSwitchTab}
              disabled={isSwitchingTab}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Switch to Live Tab
            </button>
          )}

          <button
            id="btn-goto-review"
            type="button"
            onClick={onProceedToReview}
            className="grow inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-xs hover:bg-slate-800 transition-all cursor-pointer"
          >
            Review & Verify Fields
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
