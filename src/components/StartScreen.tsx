import React, { useEffect, useState } from 'react';
import { ArrowRight, Download, ExternalLink, Globe, ShieldAlert, CheckCircle2, RefreshCw } from 'lucide-react';

interface StartScreenProps {
  onStart: (url: string) => void;
  isLoading: boolean;
}

export const StartScreen: React.FC<StartScreenProps> = ({ onStart, isLoading }) => {
  const [formUrl, setFormUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Deployment & Public URL State
  const [publicUrl, setPublicUrl] = useState('');
  const [inputPublicUrl, setInputPublicUrl] = useState('');
  const [isAiStudioDev, setIsAiStudioDev] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<{
    reachable: boolean;
    statusCode: number | null;
    authWallDetected: boolean;
    message: string;
  } | null>(null);
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/settings/public-url')
      .then((res) => res.json())
      .then((data) => {
        if (data.publicUrl) {
          setPublicUrl(data.publicUrl);
          setInputPublicUrl(data.configuredPublicUrl || data.publicUrl);
          setIsAiStudioDev(!!data.isAiStudioDev);
        }
      })
      .catch((err) => console.warn('Could not fetch public url settings:', err));
  }, []);

  const runDiagnostic = async () => {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const res = await fetch('/api/public-upload-test');
      const data = await res.json();
      setDiagResult(data);
    } catch (err: any) {
      setDiagResult({
        reachable: false,
        statusCode: null,
        authWallDetected: false,
        message: 'Diagnostic test request failed: ' + err.message,
      });
    } finally {
      setDiagRunning(false);
    }
  };

  const handleSavePublicUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingUrl(true);
    setSaveSuccess(false);
    try {
      const res = await fetch('/api/settings/public-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl: inputPublicUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setPublicUrl(data.publicUrl);
        setIsAiStudioDev(data.publicUrl.includes('ais-dev-'));
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        // Automatically rerun diagnostic on new URL
        runDiagnostic();
      }
    } catch (err) {
      console.error('Failed to save public URL:', err);
    } finally {
      setIsSavingUrl(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = formUrl.trim();
    if (!trimmed) {
      setError('Please enter or paste a valid government form link.');
      return;
    }

    try {
      new URL(trimmed);
      setError(null);
      onStart(trimmed);
    } catch {
      // If relative URL or test link
      if (trimmed.startsWith('/')) {
        setError(null);
        onStart(trimmed);
      } else {
        setError('Please enter a complete valid URL (e.g. https://portal.gov.in/form)');
      }
    }
  };

  const handleUseSample = () => {
    const origin = window.location.origin;
    const sampleUrl = `${origin}/live-test-form`;
    setFormUrl(sampleUrl);
    setError(null);
  };

  return (
    <div id="start-screen" className="max-w-2xl mx-auto py-10 px-4 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">
        SmartForm AI
      </h1>
      <p className="text-slate-600 text-base mb-6">
        Fill government forms faster and safer with AI.
      </p>

      {/* Cloud Deployment & Public Reachability Notice */}
      <div className="mb-8 p-4 rounded-xl border border-slate-200 bg-slate-50 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-xs font-semibold text-slate-900">
              Mobile Upload & QR Public Endpoint:
            </span>
          </div>
          <button
            type="button"
            onClick={runDiagnostic}
            disabled={diagRunning}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${diagRunning ? 'animate-spin' : ''}`} />
            {diagRunning ? 'Testing External...' : 'Test External Reachability'}
          </button>
        </div>

        <div className="mt-1.5 font-mono text-xs text-slate-700 bg-white px-2.5 py-1.5 rounded border border-slate-200 truncate">
          {publicUrl || 'Loading public endpoint...'}
        </div>

        {/* AI Studio Sandbox Warning */}
        {isAiStudioDev && (
          <div className="mt-2.5 flex items-start gap-2 p-2.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Development Sandbox Protected: </span>
              This development preview URL requires Google AI Studio cookies. External mobile phone cameras will be blocked by AI Studio's cookie check. To enable public phone uploads, click <strong>Deploy to Cloud Run</strong> or <strong>Share</strong> in AI Studio, or paste your public Cloud Run URL below.
            </div>
          </div>
        )}

        {/* Diagnostic Result Banner */}
        {diagResult && (
          <div className={`mt-2.5 p-2.5 rounded border text-xs flex items-start gap-2 ${
            diagResult.reachable
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}>
            {diagResult.reachable ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-semibold">
                Status: {diagResult.statusCode ? `HTTP ${diagResult.statusCode}` : 'Unreachable'} —{' '}
                {diagResult.reachable ? 'Publicly Reachable' : 'External Access Blocked'}
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">{diagResult.message}</p>
            </div>
          </div>
        )}

        {/* Public URL Override Form */}
        <form onSubmit={handleSavePublicUrl} className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-2">
          <input
            type="url"
            value={inputPublicUrl}
            onChange={(e) => setInputPublicUrl(e.target.value)}
            placeholder="Custom Cloud Run or Shared URL (e.g. https://...run.app)"
            className="grow text-xs rounded border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 placeholder:text-slate-400 focus:outline-blue-600"
          />
          <button
            type="submit"
            disabled={isSavingUrl}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-800 text-white hover:bg-slate-900 transition-colors cursor-pointer"
          >
            {isSavingUrl ? 'Saving...' : 'Set Public URL'}
          </button>
          {saveSuccess && <span className="text-xs text-emerald-600 font-medium">Saved!</span>}
        </form>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="text-left">
          <label htmlFor="form-url-input" className="block text-sm font-medium text-slate-700 mb-1.5">
            Paste the link of the government form you want to fill.
          </label>
          <div className="relative rounded-lg shadow-xs">
            <input
              id="form-url-input"
              type="text"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://example-government-site.gov/form"
              className="block w-full rounded-lg border border-slate-300 bg-white px-4 py-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-all"
              disabled={isLoading}
              autoFocus
            />
          </div>
          {error && (
            <p id="url-error" className="mt-2 text-sm text-red-600 font-medium">
              {error}
            </p>
          )}
        </div>

        <button
          id="btn-start"
          type="submit"
          disabled={isLoading}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3.5 text-base font-semibold text-white shadow-xs hover:bg-blue-700 focus:ring-4 focus:ring-blue-100 focus:outline-none disabled:opacity-50 transition-all cursor-pointer"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Starting Analysis...
            </span>
          ) : (
            <>
              Start
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </form>

      {/* Cyber Café Operator Utilities */}
      <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
        <button
          type="button"
          onClick={handleUseSample}
          className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Fill Live Sample Government Form
        </button>

        <a
          href="/api/extension/download"
          className="inline-flex items-center gap-1.5 text-slate-700 hover:text-blue-600 font-medium"
          title="Download Chrome Manifest V3 extension"
        >
          <Download className="w-3.5 h-3.5" />
          Download Chrome Extension (.zip)
        </a>
      </div>
    </div>
  );
};
