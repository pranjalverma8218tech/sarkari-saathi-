/**
 * SmartForm AI - Cyber Café Operator Application
 * Real MVP for intelligent government form automation.
 */

import React, { useEffect, useState } from 'react';
import { AnalyzingScreen } from './components/AnalyzingScreen.js';
import { AutoFillScreen } from './components/AutoFillScreen.js';
import { DocumentsScreen } from './components/DocumentsScreen.js';
import { MobileUploadView } from './components/MobileUploadView.js';
import { ReviewScreen } from './components/ReviewScreen.js';
import { StartScreen } from './components/StartScreen.js';
import { StepIndicator } from './components/StepIndicator.js';
import { ApplicationSession, FieldMapping, LearningFeedbackEvent, WorkflowMode } from './types.js';
import { openGovernmentForm } from './lib/extensionBridge.js';

export default function App() {
  // Check if current URL is a customer mobile upload view
  const urlParams = new URLSearchParams(window.location.search);
  const mobileSession = urlParams.get('session');
  const mobileToken = urlParams.get('token');
  const mobileDocName = urlParams.get('doc') || 'Required Document';
  const urlTabId = urlParams.get('tabId');
  const urlWinId = urlParams.get('winId');
  const urlMode = urlParams.get('mode') as WorkflowMode | null;
  const urlInspectedUrl = urlParams.get('inspectedUrl') || urlParams.get('url');

  if (mobileSession && mobileToken) {
    return (
      <MobileUploadView
        sessionId={mobileSession}
        token={mobileToken}
        docName={mobileDocName}
      />
    );
  }

  // Operator State
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [targetUrl, setTargetUrl] = useState<string>('');
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>(
    urlMode || (urlTabId ? 'EXTENSION_INSPECTION' : 'URL_PASTE')
  );
  const [targetTabId, setTargetTabId] = useState<number | undefined>(
    urlTabId ? parseInt(urlTabId, 10) : undefined
  );
  const [targetWindowId, setTargetWindowId] = useState<number | undefined>(
    urlWinId ? parseInt(urlWinId, 10) : undefined
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [analyzingStatus, setAnalyzingStatus] = useState<string>('Analyzing requirements...');
  const [session, setSession] = useState<ApplicationSession | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  // Auto-load session if opened from Chrome Extension with ?session=app_xxx
  useEffect(() => {
    if (mobileSession && !mobileToken) {
      setIsLoading(true);
      fetch(`/api/sessions/${mobileSession}`)
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error('Session not found');
        })
        .then((data: ApplicationSession) => {
          if (urlTabId && !data.targetTabId) {
            data.targetTabId = parseInt(urlTabId, 10);
          }
          if (urlWinId && !data.targetWindowId) {
            data.targetWindowId = parseInt(urlWinId, 10);
          }
          if (urlMode && !data.workflowMode) {
            data.workflowMode = urlMode;
          }
          if (urlInspectedUrl && !data.inspectedUrl) {
            data.inspectedUrl = urlInspectedUrl;
          }
          if (data.workflowMode) {
            setWorkflowMode(data.workflowMode);
          } else if (data.targetTabId || urlTabId) {
            setWorkflowMode('EXTENSION_INSPECTION');
          }
          setSession(data);
          setTargetUrl(data.inspectedUrl || data.url || '');
          setCurrentStep(data.extractedData && data.extractedData.length > 0 ? 4 : 3);
        })
        .catch((err) => {
          console.warn('Could not auto-load session:', err);
        })
        .finally(() => setIsLoading(false));
    }
  }, [mobileSession, mobileToken, urlTabId, urlWinId, urlMode, urlInspectedUrl]);

  // Poll session data when on Documents Screen (Step 3) to detect live uploads
  useEffect(() => {
    if (currentStep !== 3 || !session?.id) return;

    const interval = setInterval(async () => {
      try {
        setIsPolling(true);
        const res = await fetch(`/api/sessions/${session.id}`);
        if (res.ok) {
          const updatedSession: ApplicationSession = await res.json();
          setSession(updatedSession);
        }
      } catch (err) {
        console.error('Session polling failed:', err);
      } finally {
        setIsPolling(false);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [currentStep, session?.id]);

  // Step 1 -> Step 2: Start Analysis
  const handleStartAnalysis = async (url: string) => {
    const resolvedUrl = url.startsWith('/') ? `${window.location.origin}${url}` : url;
    setTargetUrl(resolvedUrl);
    setCurrentStep(2);
    setIsLoading(true);
    setErrorMessage(null);
    setAnalyzingStatus('Connecting to live government portal tab & analyzing requirements with Gemini AI...');

    try {
      // Step 2 requirement: Ask extension to open or locate the exact government portal tab
      let resolvedTabId = targetTabId;
      let resolvedWinId = targetWindowId;
      let resolvedOrigin: string | undefined = undefined;

      try {
        const extOpenRes = await openGovernmentForm(resolvedUrl);
        if (extOpenRes.success && typeof extOpenRes.tabId === 'number') {
          resolvedTabId = extOpenRes.tabId;
          resolvedWinId = extOpenRes.windowId;
          setTargetTabId(extOpenRes.tabId);
          if (extOpenRes.windowId) setTargetWindowId(extOpenRes.windowId);
          try {
            resolvedOrigin = new URL(resolvedUrl).origin;
          } catch {}
        }
      } catch (extErr) {
        console.warn('[Extension Bridge] Could not communicate with extension directly:', extErr);
      }

      const response = await fetch('/api/forms/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SmartForm-Origin': window.location.origin,
        },
        body: JSON.stringify({
          workflowMode: 'URL_PASTE',
          pastedUrl: resolvedUrl,
          formUrl: resolvedUrl,
          targetTabId: resolvedTabId,
          targetWindowId: resolvedWinId,
          targetOrigin: resolvedOrigin,
          origin: window.location.origin,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze government form');
      }

      const sessionTabId = data.targetTabId ?? resolvedTabId;
      const sessionWinId = data.targetWindowId ?? resolvedWinId;
      const sessionOrigin = data.targetOrigin ?? resolvedOrigin;

      // Construct session from response
      const newSession: ApplicationSession = {
        id: data.sessionId,
        workflowMode: 'URL_PASTE',
        pastedUrl: resolvedUrl,
        url: resolvedUrl,
        targetTabId: sessionTabId,
        targetWindowId: sessionWinId,
        targetOrigin: sessionOrigin,
        status: 'waiting_documents',
        detectedFields: data.detectedFields || [],
        requirements: data.requirements || [],
        documentRequirements: data.documentRequirements || [],
        extractedData: [],
        mappings: [],
        unfilledRequiredFields: [],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
        storagePurged: false,
      };

      setSession(newSession);

      // Brief transition delay for visual feedback
      setTimeout(() => {
        setIsLoading(false);
        setCurrentStep(3); // Go to Document Upload
      }, 1000);
    } catch (err: any) {
      console.error('Analysis error:', err);
      setIsLoading(false);
      setErrorMessage(err.message || 'Analysis failed. Please check backend connection.');
      setCurrentStep(1); // Return to Start
    }
  };

  // Step 3 Refresh
  const handleRefreshSession = async () => {
    if (!session?.id) return;
    try {
      setIsPolling(true);
      const res = await fetch(`/api/sessions/${session.id}`);
      if (res.ok) {
        const updated: ApplicationSession = await res.json();
        setSession(updated);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsPolling(false);
    }
  };

  // Step 3 -> Step 4: Proceed to Auto-Fill
  const handleProceedToAutoFill = async () => {
    if (!session?.id) return;
    // Re-fetch latest session state first
    try {
      const res = await fetch(`/api/sessions/${session.id}`);
      if (res.ok) {
        const updated = await res.json();
        setSession(updated);
      }
    } catch (e) {}

    setCurrentStep(4);
  };

  // Step 4 -> Step 5: Proceed to Review
  const handleProceedToReview = () => {
    setCurrentStep(5);
  };

  // Update Mappings in Review (Operator Edits & Feedback)
  const handleUpdateMapping = async (
    updatedMappings: FieldMapping[],
    feedback?: LearningFeedbackEvent
  ) => {
    if (!session?.id) return;
    try {
      await fetch('/api/mappings/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          mappings: updatedMappings,
          feedbackEvent: feedback,
        }),
      });

      setSession((prev) => (prev ? { ...prev, mappings: updatedMappings } : null));
    } catch (err) {
      console.error('Failed to confirm mappings:', err);
    }
  };

  // Step 5: Storage Purge
  const handlePurgeStorage = async () => {
    if (!session?.id) {
      return { success: false, message: 'No active session to purge' };
    }

    const res = await fetch('/api/storage/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      setSession((prev) => (prev ? { ...prev, storagePurged: true } : null));
      return {
        success: true,
        message: `${data.purgedFilesCount} temporary files removed and extracted session data cleared from database.`,
      };
    } else {
      return {
        success: false,
        message: data.error || 'Temporary storage purge failed on server.',
      };
    }
  };

  const handleStartNew = () => {
    setSession(null);
    setTargetUrl('');
    setCurrentStep(1);
    setErrorMessage(null);
  };

  const verifiedDocTypes =
    session?.documentRequirements
      .filter((d) => d.status === 'verified')
      .map((d) => d.documentType) || [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
      {/* Top Simple Bar */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-xs sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 tracking-tight text-base">
              SmartForm AI
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
              Operator Assistant
            </span>
          </div>

          <div className="flex items-center gap-3">
            {workflowMode === 'EXTENSION_INSPECTION' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-full text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Mode 2: Live Page Extension Assistant
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 text-blue-800 rounded-full text-xs font-semibold">
                Mode 1: URL-Paste Form Assistant
              </span>
            )}

            <div className="text-xs text-slate-500 font-medium hidden sm:block">
              Cyber Café Workstation
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-5xl w-full mx-auto px-4 py-8 flex-1">
        {/* Step Indicator (Visible from step 1 to 5) */}
        <StepIndicator currentStep={currentStep} />

        {/* Global Error Notice if any */}
        {errorMessage && (
          <div className="max-w-xl mx-auto mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium text-center">
            {errorMessage}
          </div>
        )}

        {/* Screen 1: Start */}
        {currentStep === 1 && (
          <StartScreen onStart={handleStartAnalysis} isLoading={isLoading} />
        )}

        {/* Screen 2: Analyzing */}
        {currentStep === 2 && (
          <AnalyzingScreen
            url={targetUrl}
            fieldsCount={session?.detectedFields?.length}
            statusMessage={analyzingStatus}
          />
        )}

        {/* Screen 3: Documents Upload with Dedicated Single-Purpose QRs */}
        {currentStep === 3 && session && (
          <DocumentsScreen
            formTitle={session.detectedFields?.[0]?.label ? 'Public Application Portal' : 'Government Form'}
            documentRequirements={session.documentRequirements}
            onProceedToAutoFill={handleProceedToAutoFill}
            onRefreshSession={handleRefreshSession}
            isPolling={isPolling}
          />
        )}

        {/* Screen 4: Processing / Auto-Fill */}
        {currentStep === 4 && session && (
          <AutoFillScreen
            sessionId={session.id}
            workflowMode={session.workflowMode || workflowMode}
            targetTabId={session.targetTabId}
            targetWindowId={session.targetWindowId}
            mappings={session.mappings}
            verifiedDocTypes={verifiedDocTypes}
            targetUrl={session.url || targetUrl}
            pastedUrl={session.pastedUrl}
            inspectedUrl={session.inspectedUrl}
            onProceedToReview={handleProceedToReview}
          />
        )}

        {/* Screen 5: Review, Operator Verification, Manual Submit, & Data Purge */}
        {currentStep === 5 && session && (
          <ReviewScreen
            sessionId={session.id}
            workflowMode={session.workflowMode || workflowMode}
            targetTabId={session.targetTabId}
            targetWindowId={session.targetWindowId}
            mappings={session.mappings}
            targetUrl={session.url || targetUrl}
            pastedUrl={session.pastedUrl}
            inspectedUrl={session.inspectedUrl || session.url || targetUrl}
            pageTitle={session.pageTitle}
            onUpdateMapping={handleUpdateMapping}
            onPurgeStorage={handlePurgeStorage}
            onStartNew={handleStartNew}
          />
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        <p>SmartForm AI • Final submission must always be performed manually on the official website.</p>
      </footer>
    </div>
  );
}
