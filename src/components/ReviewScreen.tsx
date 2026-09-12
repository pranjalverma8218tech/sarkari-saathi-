import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit2,
  ExternalLink,
  Lock,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { FieldMapping, LearningFeedbackEvent } from '../types.js';

interface ReviewScreenProps {
  sessionId: string;
  mappings: FieldMapping[];
  targetUrl: string;
  onUpdateMapping: (updatedMappings: FieldMapping[], feedback?: LearningFeedbackEvent) => Promise<void>;
  onPurgeStorage: () => Promise<{ success: boolean; message: string }>;
  onStartNew: () => void;
}

export const ReviewScreen: React.FC<ReviewScreenProps> = ({
  sessionId,
  mappings,
  targetUrl,
  onUpdateMapping,
  onPurgeStorage,
  onStartNew,
}) => {
  const [currentMappings, setCurrentMappings] = useState<FieldMapping[]>(mappings);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [purgeStatus, setPurgeStatus] = useState<{
    attempted: boolean;
    success: boolean;
    message: string;
  } | null>(null);
  const [verifiedByOperator, setVerifiedByOperator] = useState(false);

  // Split into auto-filled vs requires attention
  const autoFilled = currentMappings.filter((m) => !m.isManualEntry && m.extractedValue && m.status !== 'manual_required');
  const requiresAttention = currentMappings.filter(
    (m) => m.isManualEntry || !m.extractedValue || m.status === 'manual_required'
  );

  const startEdit = (m: FieldMapping) => {
    setEditingId(m.id);
    setEditValue(m.extractedValue || '');
  };

  const saveEdit = async (m: FieldMapping) => {
    const updated = currentMappings.map((item) => {
      if (item.id === m.id) {
        return {
          ...item,
          extractedValue: editValue,
          status: 'confirmed' as const,
          editedByOperator: true,
        };
      }
      return item;
    });
    setCurrentMappings(updated);
    setEditingId(null);

    // Save learning feedback for continuous improvement
    const feedback: LearningFeedbackEvent = {
      formDomain: new URL(targetUrl).hostname || '',
      fieldLabel: m.targetField,
      fieldName: m.targetName,
      aiPredictedMapping: m.extractedValue,
      operatorConfirmedMapping: editValue,
      wasCorrected: editValue !== m.extractedValue,
    };

    await onUpdateMapping(updated, feedback);

    // Dispatch update to live webpage DOM
    window.postMessage(
      {
        type: 'SMARTFORM_AUTO_FILL_REQUEST',
        mappings: [{ ...m, extractedValue: editValue }],
      },
      '*'
    );
  };

  const handlePurge = async () => {
    setIsPurging(true);
    try {
      const res = await onPurgeStorage();
      setPurgeStatus({
        attempted: true,
        success: res.success,
        message: res.message,
      });
    } catch (e: any) {
      setPurgeStatus({
        attempted: true,
        success: false,
        message: 'Temporary file deletion pending: ' + (e.message || 'Network error'),
      });
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div id="review-screen" className="max-w-4xl mx-auto py-8 px-4">
      {/* Header Notice */}
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-1">
          Form Verification Summary
        </h2>
        <p className="text-sm text-slate-600">
          Please verify all details carefully before final submission on the government website.
        </p>
      </div>

      {/* Summary Counts Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-emerald-800 uppercase tracking-wider">
              Automatically Filled
            </div>
            <div className="text-lg font-bold text-emerald-900">
              {autoFilled.length} fields mapped from documents
            </div>
          </div>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs font-semibold text-amber-800 uppercase tracking-wider">
              Requires Your Attention
            </div>
            <div className="text-lg font-bold text-amber-900">
              {requiresAttention.length} fields (manual entry / missing)
            </div>
          </div>
        </div>
      </div>

      {/* Missing / Manual Fields Attention Box */}
      {requiresAttention.length > 0 && (
        <div className="mb-6 p-4 bg-white border border-amber-300 rounded-xl shadow-xs">
          <h3 className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Fields that still require manual input on the website:
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
            {requiresAttention.map((m) => (
              <li key={m.id} className="flex items-center gap-2 p-1.5 bg-amber-50/60 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="font-semibold">{m.targetField}</span>
                <span className="text-slate-500 text-[11px] ml-auto">
                  {m.isManualEntry ? '(Manual Entry)' : '(Document Not Found)'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Main Verification Table */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden mb-8">
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Field Verification Table
          </span>
          <span className="text-xs text-slate-500">
            Click edit icon to adjust values
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/50 text-xs text-slate-500 uppercase border-b border-slate-100">
              <tr>
                <th className="px-5 py-3 font-semibold">Field</th>
                <th className="px-5 py-3 font-semibold">Value</th>
                <th className="px-5 py-3 font-semibold">Source</th>
                <th className="px-5 py-3 font-semibold">Confidence</th>
                <th className="px-5 py-3 font-semibold text-center">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentMappings.map((m) => {
                const isEditing = editingId === m.id;
                const isManual = m.isManualEntry || !m.extractedValue || m.status === 'manual_required';

                return (
                  <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-900">
                      {m.targetField}
                    </td>

                    <td className="px-5 py-3.5 text-slate-700">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="px-2 py-1 border border-blue-500 rounded-md text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                            autoFocus
                          />
                          <button
                            onClick={() => saveEdit(m)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-semibold cursor-pointer"
                          >
                            Save
                          </button>
                        </div>
                      ) : m.extractedValue ? (
                        <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">
                          {m.extractedValue}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">________</span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-xs text-slate-600">
                      {m.source}
                    </td>

                    <td className="px-5 py-3.5 text-xs font-medium">
                      {m.isManualEntry ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className="text-emerald-700">
                          {Math.round(m.confidence * 100)}%
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-center">
                      {isManual ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="w-3 h-3" />
                          Required
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          Filled
                        </span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      {!isEditing && (
                        <button
                          onClick={() => startEdit(m)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded cursor-pointer transition-colors"
                          title="Edit value"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Critical Verification & Manual Submission Callout */}
      <div className="p-6 bg-slate-900 text-white rounded-xl mb-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-white mb-1">
              Final Submission Must Be Performed Manually
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              To protect applicants against erroneous filings and comply with government portal terms, SmartForm AI will <strong>never</strong> automatically click the final Submit button.
              Inspect the live webpage in Chrome, verify all entries with the applicant, and click Submit manually on the government website.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={targetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs transition-colors"
              >
                Go to Live Government Form Tab
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none bg-slate-800/80 px-3 py-2 rounded-lg border border-slate-700">
                <input
                  type="checkbox"
                  checked={verifiedByOperator}
                  onChange={(e) => setVerifiedByOperator(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-0 cursor-pointer"
                />
                I have verified all fields with the customer
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Retention Policy & True Storage Purge */}
      <div className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-bold text-slate-900">
              Customer Privacy & Document Retention Policy
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Permanently purge uploaded documents and temporary extracted personal data after form completion.
            </p>
          </div>
        </div>

        <button
          id="btn-purge-storage"
          onClick={handlePurge}
          disabled={isPurging}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100 transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {isPurging ? 'Purging Files...' : 'Permanently Purge Temporary Data'}
        </button>
      </div>

      {/* Actual Purge Status Display */}
      {purgeStatus && (
        <div
          className={`mt-4 p-4 rounded-xl border text-xs font-medium ${
            purgeStatus.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          {purgeStatus.success ? (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>✓ Permanently Purged: {purgeStatus.message}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>⚠ {purgeStatus.message}</span>
            </div>
          )}
        </div>
      )}

      {/* Start Next Form */}
      <div className="mt-8 text-center pt-6 border-t border-slate-200">
        <button
          onClick={onStartNew}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Process Another Government Form
        </button>
      </div>
    </div>
  );
};
