import React, { useState } from 'react';
import { ShieldAlert, FileText, X } from 'lucide-react';

interface EulaDialogProps {
  isOpen: boolean;
  onAccept: () => void;
}

const LICENSE_TEXT = `TEKTRONIX SAMPLE SOURCE CODE LICENSE AGREEMENT

Source code written by Tektronix, Inc. or its affiliates ("Tektronix") that is designated as a "sample," "example," "sample code," or any similar designation will be considered "Sample Source Code." Tektronix grants you a license to download, reproduce, display, distribute, modify, and create derivative works of Tektronix Sample Source Code, only for use in or with Tektronix products. You may not remove or alter any copyright notices or trademarks.

SAMPLE SOURCE CODE IS PROVIDED "AS-IS," WITHOUT ANY EXPRESS OR IMPLIED WARRANTIES OF ANY KIND, INCLUDING BUT NOT LIMITED TO THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT OF INTELLECTUAL PROPERTY. IN NO EVENT SHALL TEKTRONIX, ITS AFFILIATES, OFFICERS, EMPLOYEES, DIRECTORS, AGENTS, SUPPLIERS, OR OTHER THIRD PARTIES BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, PUNITIVE, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SAMPLE SOURCE CODE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

export const EulaDialog: React.FC<EulaDialogProps> = ({ isOpen, onAccept }) => {
  const [betaAcknowledged, setBetaAcknowledged] = useState(false);
  const [licenseAcknowledged, setLicenseAcknowledged] = useState(false);
  const [declined, setDeclined] = useState(false);

  if (!isOpen) return null;

  const canAccept = betaAcknowledged && licenseAcknowledged;

  if (declined) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <X className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
            License Agreement Required
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
            You must accept the license agreement and beta terms to use TekAutomate.
            Please close the application or go back to review the agreement.
          </p>
          <button
            type="button"
            onClick={() => setDeclined(false)}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-8 pt-8 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                License Agreement & Beta Notice
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Please review before continuing
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-8 pb-4 space-y-5">
          {/* Beta Disclaimer */}
          <div className="rounded-lg border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <h2 className="text-sm font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                Unofficial Prototype — Evaluation Software Notice
              </h2>
            </div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-3">
              This is an <strong>unofficial tool</strong> and is <strong>not an official Tektronix product</strong>. It should not be confused with any official Tektronix software or service.
            </p>
            <ul className="space-y-2 text-sm text-amber-900 dark:text-amber-200">
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">&#8226;</span>
                TekAutomate is an unofficial prototype created for <strong>evaluation and testing purposes only</strong>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">&#8226;</span>
                It is not endorsed, supported, or maintained by Tektronix as an official product
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">&#8226;</span>
                Features may change, break, or be removed without notice
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">&#8226;</span>
                Data loss or unexpected behavior may occur
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">&#8226;</span>
                <strong>Tektronix and its contributors are not responsible for any damages, data loss, or issues arising from the use of this software</strong>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">&#8226;</span>
                Not intended for production or mission-critical use
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500 mt-0.5">&#8226;</span>
                No guarantee of support, uptime, or continued availability
              </li>
            </ul>
          </div>

          {/* License text */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Tektronix Sample Source Code License
            </h2>
            <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 p-4 max-h-48 overflow-y-auto">
              <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                {LICENSE_TEXT}
              </pre>
            </div>
          </div>

          {/* Checkboxes */}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={betaAcknowledged}
                onChange={(e) => setBetaAcknowledged(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-500 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                I understand this is beta software and accept the associated risks
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={licenseAcknowledged}
                onChange={(e) => setLicenseAcknowledged(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-500 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                I have read and agree to the Tektronix Sample Source Code License Agreement
              </span>
            </label>
          </div>
        </div>

        {/* Footer with buttons */}
        <div className="px-8 py-5 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setDeclined(true)}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={!canAccept}
            className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              canAccept
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            }`}
          >
            Accept & Continue
          </button>
        </div>
      </div>
    </div>
  );
};
