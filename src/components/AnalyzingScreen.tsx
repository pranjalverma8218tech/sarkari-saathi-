import React from 'react';
import { Check, Loader2 } from 'lucide-react';

interface AnalyzingScreenProps {
  url: string;
  fieldsCount?: number;
  statusMessage: string;
}

export const AnalyzingScreen: React.FC<AnalyzingScreenProps> = ({
  url,
  fieldsCount,
  statusMessage,
}) => {
  return (
    <div id="analyzing-screen" className="max-w-md mx-auto py-12 px-6 text-center">
      <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-5">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>

      <h2 className="text-xl font-bold text-slate-900 mb-2">
        Analyzing Government Form
      </h2>
      <p className="text-xs text-slate-500 break-all mb-8 font-mono bg-slate-100 py-1.5 px-3 rounded-md">
        {url}
      </p>

      <div className="space-y-3.5 text-left max-w-sm mx-auto">
        {/* State 1 */}
        <div className="flex items-center gap-3 text-sm">
          <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </div>
          <span className="text-slate-800 font-medium">Website detected</span>
        </div>

        {/* State 2 */}
        <div className="flex items-center gap-3 text-sm">
          <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
            <Check className="w-3.5 h-3.5 stroke-[3]" />
          </div>
          <span className="text-slate-800 font-medium">
            Fields detected {fieldsCount ? `(${fieldsCount} fields)` : ''}
          </span>
        </div>

        {/* State 3 */}
        <div className="flex items-center gap-3 text-sm">
          <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          </div>
          <span className="text-blue-900 font-semibold">{statusMessage}</span>
        </div>
      </div>
    </div>
  );
};
