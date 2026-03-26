import React, { useState } from 'react';
import { X, Monitor, Zap, Settings, Rocket, CheckCircle, Image, Download, FileText, AlertCircle, HelpCircle } from 'lucide-react';
import { useHelp } from './Academy/useHelp';

export type DeviceFamily = 'oscilloscope_mso' | 'oscilloscope_70k' | 'awg' | 'smu' | 'other';
export type BackendChoice = 'pyvisa' | 'tm_devices' | 'tekhsi';
export type Intent = 'connection_check' | 'screen_capture' | 'acquire_data' | 'empty';

export interface WizardData {
  // Step 1: Target
  host: string;
  deviceFamily: DeviceFamily | null;
  
  // Step 2: Engine
  backend: BackendChoice | null;
  
  // Step 3: Launchpad
  intent: Intent | null;
}

interface WelcomeWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: WizardData) => void;
}

export const WelcomeWizard: React.FC<WelcomeWizardProps> = ({ isOpen, onClose, onComplete }) => {
  const [step, setStep] = useState(1);
  const [wizardData, setWizardData] = useState<WizardData>({
    host: '',
    deviceFamily: null,
    backend: null,
    intent: null,
  });
  const { openArticle } = useHelp();

  if (!isOpen) return null;

  const handleNext = () => {
    if (step === 1 && wizardData.host && wizardData.deviceFamily) {
      setStep(2);
    } else if (step === 2 && wizardData.backend) {
      setStep(3);
    } else if (step === 3 && wizardData.intent) {
      onComplete(wizardData);
      onClose();
    }
  };

  const handleSkip = () => {
    // Skip with defaults
    onComplete({
      host: wizardData.host || '127.0.0.1',
      deviceFamily: wizardData.deviceFamily || 'oscilloscope_mso',
      backend: wizardData.backend || 'pyvisa',
      intent: wizardData.intent || 'empty',
    });
    onClose();
  };

  const handleUSBGPIB = () => {
    // Close wizard immediately for USB/GPIB users
    onClose();
  };

  const updateWizardData = (updates: Partial<WizardData>) => {
    setWizardData(prev => ({ ...prev, ...updates }));
  };

  const isTekHSIEnabled = wizardData.deviceFamily === 'oscilloscope_mso' || wizardData.deviceFamily === 'oscilloscope_70k';
  const isScreenCaptureDisabled = wizardData.deviceFamily === 'awg' || wizardData.deviceFamily === 'smu' || wizardData.deviceFamily === 'other';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-4xl p-8 shadow-2xl my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <Rocket className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Quick Setup Wizard</h2>
              <p className="text-sm text-gray-500">Get started in 3 simple steps</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 hover:bg-gray-100 rounded-lg"
          >
            <X size={24} />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex gap-2 mb-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-2 rounded-full transition-all ${
                  s < step ? 'bg-blue-600' : s === step ? 'bg-blue-400' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span className={step >= 1 ? 'text-blue-600 font-medium' : ''}>Target</span>
            <span className={step >= 2 ? 'text-blue-600 font-medium' : ''}>Engine</span>
            <span className={step >= 3 ? 'text-blue-600 font-medium' : ''}>Launchpad</span>
          </div>
        </div>

        {/* Step 1: Target (Hardware Context) */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-2 text-gray-900">Which instrument are we connecting to?</h3>
              <p className="text-sm text-gray-600 mb-6">Enter the IP address or hostname of your instrument</p>
              
              {/* Primary Input: IP Address / Hostname */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  IP Address / Hostname <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={wizardData.host}
                  onChange={(e) => updateWizardData({ host: e.target.value })}
                  placeholder="e.g., 192.168.1.55 or C-MSO64-12345"
                  className="w-full px-4 py-4 text-lg border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">This is the most important piece of information</p>
              </div>

              {/* Secondary Input: Device Family */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Device Family <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'oscilloscope_mso', label: 'Oscilloscope (MSO 4/5/6/7)', icon: Monitor, desc: 'MSO Series' },
                    { value: 'oscilloscope_70k', label: '70K Series', icon: Monitor, desc: '70K Oscilloscopes' },
                    { value: 'awg', label: 'AWG', icon: Zap, desc: 'Arbitrary Waveform Generator' },
                    { value: 'smu', label: 'Source Measure Unit (SMU)', icon: Settings, desc: 'SMU Instruments' },
                    { value: 'other', label: 'Other', icon: HelpCircle, desc: 'Other instrument types' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateWizardData({ deviceFamily: option.value as DeviceFamily })}
                      className={`p-4 text-left border-2 rounded-lg transition-all flex items-start gap-3 ${
                        wizardData.deviceFamily === option.value
                          ? 'border-blue-600 bg-blue-50 shadow-md'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`mt-1 ${wizardData.deviceFamily === option.value ? 'text-blue-600' : 'text-gray-400'}`}>
                        <option.icon size={20} />
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900">{option.label}</div>
                        <div className="text-xs text-gray-600 mt-1">{option.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* USB/GPIB Link */}
              <div className="pt-4 border-t border-gray-200">
                <button
                  onClick={handleUSBGPIB}
                  className="text-sm text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                >
                  <AlertCircle size={14} />
                  Using USB or GPIB? Click here to configure manually
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Engine (Driver/Backend) */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-2 text-gray-900">How do you want to communicate?</h3>
              <p className="text-sm text-gray-600 mb-6">Choose the Python backend that best fits your needs</p>
              
              {/* Main Options: PyVISA and tm_devices side-by-side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* Card A: PyVISA */}
                <button
                  onClick={() => updateWizardData({ backend: 'pyvisa' })}
                  className={`p-6 border-2 rounded-xl transition-all text-left ${
                    wizardData.backend === 'pyvisa'
                      ? 'border-blue-600 bg-blue-50 shadow-lg'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                      <CheckCircle className="h-6 w-6 text-green-600" />
                    </div>
                    <span className={`px-2 py-1 text-xs font-semibold rounded ${
                      wizardData.backend === 'pyvisa' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      Legacy
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-2">PyVISA</h4>
                  <p className="text-sm text-gray-600 mb-3">Handles SCPI commands via VISA. Uses VXI-11 if connection is made without socket port. If socket port is used, connections are made to scope using that port to allow barebone SCPI read/write/query.</p>
                  <p className="text-xs text-gray-500 font-medium mt-3">Best for:</p>
                  <p className="text-xs text-gray-600">Older instruments, simple SCPI commands, maximum compatibility</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openArticle('backend_comparison');
                    }}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                  >
                    Learn More →
                  </button>
                </button>

                {/* Card B: tm_devices */}
                <button
                  onClick={() => updateWizardData({ backend: 'tm_devices' })}
                  className={`p-6 border-2 rounded-xl transition-all text-left ${
                    wizardData.backend === 'tm_devices'
                      ? 'border-blue-600 bg-blue-50 shadow-lg'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Rocket className="h-6 w-6 text-blue-600" />
                    </div>
                    <span className={`px-2 py-1 text-xs font-semibold rounded ${
                      wizardData.backend === 'tm_devices' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                    }`}>
                      Modern
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-2">tm_devices</h4>
                  <p className="text-sm text-gray-600 mb-3">Functions wrapped up nicely with object-oriented Python. Also allows raw SCPI commands when needed. Provides auto-completion and helper functions.</p>
                  <p className="text-xs text-gray-500 font-medium mt-3">Best for:</p>
                  <p className="text-xs text-gray-600">Modern Tektronix instruments, clean code, developer productivity</p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openArticle('backend_comparison');
                    }}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                  >
                    Learn More →
                  </button>
                </button>
              </div>

              {/* Special Case: TekHSI (only for oscilloscopes) */}
              {isTekHSIEnabled && (
                <div className="border-t border-gray-200 pt-6">
                  <div className="mb-3">
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Special Use Case:</h4>
                    <p className="text-xs text-gray-500">For high-speed waveform acquisition only</p>
                  </div>
                  <button
                    onClick={() => updateWizardData({ backend: 'tekhsi' })}
                    className={`w-full p-6 border-2 rounded-xl transition-all text-left ${
                      wizardData.backend === 'tekhsi'
                        ? 'border-purple-600 bg-purple-50 shadow-lg'
                        : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        wizardData.backend === 'tekhsi' ? 'bg-purple-100' : 'bg-gray-100'
                      }`}>
                        <Zap className={`h-6 w-6 ${wizardData.backend === 'tekhsi' ? 'text-purple-600' : 'text-gray-400'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-lg font-bold text-gray-900">TekHSI</h4>
                          <span className={`px-2 py-1 text-xs font-semibold rounded ${
                            wizardData.backend === 'tekhsi' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                          }`}>
                            Performance
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mb-2">For fast, huge waveform pulls in realtime with SFP+ port. Uses gRPC for high-speed data transfer.</p>
                        <p className="text-xs text-gray-500 font-medium">When to use:</p>
                        <p className="text-xs text-gray-600">Only when you need maximum waveform transfer speed on oscilloscopes with SFP+ connectivity</p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateWizardData({ backend: 'tekhsi' });
                            openArticle('backend_comparison');
                          }}
                          className="mt-2 text-xs text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
                        >
                          Learn More →
                        </button>
                      </div>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Launchpad (Intent) */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-2 text-gray-900">What is your immediate goal?</h3>
              <p className="text-sm text-gray-600 mb-6">We'll pre-fill your workflow with the right steps</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Option A: Connection Check */}
                <button
                  onClick={() => updateWizardData({ intent: 'connection_check' })}
                  className={`p-6 border-2 rounded-xl transition-all text-left ${
                    wizardData.intent === 'connection_check'
                      ? 'border-blue-600 bg-blue-50 shadow-lg'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      wizardData.intent === 'connection_check' ? 'bg-green-100' : 'bg-gray-100'
                    }`}>
                      <CheckCircle className={`h-5 w-5 ${
                        wizardData.intent === 'connection_check' ? 'text-green-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900">Connection Check</h4>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">I just want to see if this thing works.</p>
                  <p className="text-xs text-gray-500">Steps: Connect → Query: *IDN?</p>
                </button>

                {/* Option B: Screen Capture */}
                <button
                  onClick={() => !isScreenCaptureDisabled && updateWizardData({ intent: 'screen_capture' })}
                  disabled={isScreenCaptureDisabled}
                  className={`p-6 border-2 rounded-xl transition-all text-left relative ${
                    isScreenCaptureDisabled
                      ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                      : wizardData.intent === 'screen_capture'
                      ? 'border-blue-600 bg-blue-50 shadow-lg'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                  title={isScreenCaptureDisabled ? 'Screen capture not available for this device type' : ''}
                >
                  {isScreenCaptureDisabled && (
                    <div className="absolute top-2 right-2">
                      <span className="px-2 py-1 text-xs font-semibold rounded bg-gray-200 text-gray-600">
                        Not Available
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      isScreenCaptureDisabled 
                        ? 'bg-gray-100' 
                        : wizardData.intent === 'screen_capture' ? 'bg-purple-100' : 'bg-gray-100'
                    }`}>
                      <Image className={`h-5 w-5 ${
                        isScreenCaptureDisabled 
                          ? 'text-gray-400' 
                          : wizardData.intent === 'screen_capture' ? 'text-purple-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900">Screen Capture</h4>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">I need a picture for my report.</p>
                  <p className="text-xs text-gray-500">
                    {isScreenCaptureDisabled 
                      ? 'Not supported on this hardware'
                      : 'Steps: Connect → Write: SAVe:IMAGe → Save Waveform'}
                  </p>
                </button>

                {/* Option C: Acquire Data */}
                <button
                  onClick={() => updateWizardData({ intent: 'acquire_data' })}
                  className={`p-6 border-2 rounded-xl transition-all text-left ${
                    wizardData.intent === 'acquire_data'
                      ? 'border-blue-600 bg-blue-50 shadow-lg'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      wizardData.intent === 'acquire_data' ? 'bg-orange-100' : 'bg-gray-100'
                    }`}>
                      <Download className={`h-5 w-5 ${
                        wizardData.intent === 'acquire_data' ? 'text-orange-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900">Acquire Data</h4>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">I need raw numbers/CSV.</p>
                  <p className="text-xs text-gray-500">Steps: Connect → Write: DATa:SOUrce → Save Waveform</p>
                </button>

                {/* Option D: Empty Project */}
                <button
                  onClick={() => updateWizardData({ intent: 'empty' })}
                  className={`p-6 border-2 rounded-xl transition-all text-left ${
                    wizardData.intent === 'empty'
                      ? 'border-blue-600 bg-blue-50 shadow-lg'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      wizardData.intent === 'empty' ? 'bg-gray-100' : 'bg-gray-50'
                    }`}>
                      <FileText className={`h-5 w-5 ${
                        wizardData.intent === 'empty' ? 'text-gray-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900">Empty Project</h4>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">I know what I'm doing, leave me alone.</p>
                  <p className="text-xs text-gray-500">Start with a blank workflow</p>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-200">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Skip Wizard
          </button>
          <div className="flex gap-3">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-6 py-2 text-sm border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={
                (step === 1 && (!wizardData.host || !wizardData.deviceFamily)) ||
                (step === 2 && !wizardData.backend) ||
                (step === 3 && !wizardData.intent)
              }
              className="px-6 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium shadow-md"
            >
              {step === 3 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
