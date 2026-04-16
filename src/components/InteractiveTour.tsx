import React from 'react';
import Joyride, { CallBackProps, Step, STATUS } from 'react-joyride';

interface InteractiveTourProps {
  run: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export const InteractiveTour: React.FC<InteractiveTourProps> = ({ run, onComplete, onSkip }) => {
  const steps: Step[] = [
    {
      target: '[data-tour="builder-button"]',
      content: 'The Builder is where you create automation workflows by adding steps like connect, write, query, and more. Build your script step by step here.',
      placement: 'bottom',
      disableBeacon: true,
    },
    {
      target: '[data-tour="commands-button"]',
      content: 'Browse the Commands library to find SCPI commands for your instrument. Search by name, category, or browse by device type.',
      placement: 'bottom',
    },
    {
      target: '[data-tour="templates-button"]',
      content: 'Templates provide pre-built workflows for common tasks. Use built-in templates or import your own. Templates automatically set the correct backend.',
      placement: 'bottom',
    },
    {
      target: '[data-tour="builder-button"]',
      content: 'Now let\'s go back to the Builder to see your workflow and explore more features.',
      placement: 'bottom',
      disableScrolling: false,
    },
    {
      target: '[data-tour="show-config-button"]',
      content: 'Use this gear icon to show or hide the configuration panel. The config panel lets you manage instrument connections and settings.',
      placement: 'left',
      disableScrolling: false,
    },
    {
      target: '[data-tour="config-panel"]',
      content: 'Configure your instrument connection here. Set the host, port, backend (PyVISA, tm_devices, TekHSI), and device type. You can add multiple instruments.',
      placement: 'right',
      disableScrolling: false,
    },
    {
      target: '[data-tour="add-instrument-button"]',
      content: 'Click "Add Instrument" to add more devices to your setup. You can configure multiple instruments and switch between them in your workflow.',
      placement: 'left',
      disableScrolling: false,
    },
    {
      target: '[data-tour="steps-panel"]',
      content: 'This is your workflow steps panel. Add steps, organize them in groups, drag to reorder, and right-click for more options like duplicate.',
      placement: 'top',
    },
    {
      target: '[data-tour="undo-button"]',
      content: 'Use Undo and Redo to easily revert changes or reapply them. Keyboard shortcuts: Ctrl+Z for Undo, Ctrl+Y for Redo.',
      placement: 'bottom',
    },
    {
      target: '[data-tour="flow-dropdown"]',
      content: 'The Flow dropdown lets you import and export your workflow as JSON files. Save your work or share workflows with others.',
      placement: 'bottom',
    },
    {
      target: '[data-tour="gen-code-button"]',
      content: 'Generate Code creates a complete Python script from your workflow. Configure export options and download the ready-to-run automation script.',
      placement: 'left',
    },
    {
      target: '[data-tour="help-dropdown"]',
      content: 'Access help resources here. The Wizard guides you through initial setup, and the Tour (like this one) shows you around the interface.',
      placement: 'bottom',
    },
  ];

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, action, index, type } = data;
    
    // Handle step transitions - navigate BEFORE step is shown
    if (type === 'step:before') {
      const step = steps[index];
      
      // Before showing commands-button step, ensure we're on commands page
      if (step?.target === '[data-tour="commands-button"]') {
        const commandsBtn = document.querySelector('[data-tour="commands-button"]');
        if (commandsBtn && !(commandsBtn as HTMLElement).classList.contains('bg-blue-600')) {
          (commandsBtn as HTMLElement).click();
        }
      }
      
      // Before showing templates-button step, ensure we're on templates page
      if (step?.target === '[data-tour="templates-button"]') {
        const templatesBtn = document.querySelector('[data-tour="templates-button"]');
        if (templatesBtn && !(templatesBtn as HTMLElement).classList.contains('bg-blue-600')) {
          (templatesBtn as HTMLElement).click();
        }
        // Always wait for layout to stabilize, even if already on templates page
        setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const btn = document.querySelector('[data-tour="templates-button"]') as HTMLElement;
              if (btn) {
                void btn.offsetHeight; // Force reflow
                window.dispatchEvent(new Event('resize'));
              }
            });
          });
        }, 100);
      }
      
    }
    
    // Handle step after it's shown - trigger position recalculation if needed
    if (type === 'step:after') {
      const step = steps[index];
      
      // After templates-button step is shown, ensure position is correct
      if (step?.target === '[data-tour="templates-button"]') {
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('resize'));
        });
      }
    }
    
    // Handle navigation and visibility
    if (action === 'next' || action === 'prev') {
      const currentStep = steps[index];
      const nextStep = action === 'next' ? steps[index + 1] : steps[index - 1];
      
      // Navigate back to builder after templates step (step 3 -> step 4)
      if (currentStep?.target === '[data-tour="templates-button"]' && action === 'next' && nextStep?.target === '[data-tour="builder-button"]') {
        setTimeout(() => {
          const builderBtn = document.querySelector('[data-tour="builder-button"]');
          if (builderBtn) {
            (builderBtn as HTMLElement).click();
          }
        }, 300);
      }
      
      // Ensure config panel is visible when showing config-related steps
      if (currentStep?.target === '[data-tour="config-panel"]' || 
          currentStep?.target === '[data-tour="add-instrument-button"]' ||
          currentStep?.target === '[data-tour="show-config-button"]') {
        // Show config panel if it's hidden
        const configPanel = document.querySelector('[data-tour="config-panel"]');
        if (!configPanel) {
          const showConfigBtn = document.querySelector('[data-tour="show-config-button"]');
          if (showConfigBtn) {
            (showConfigBtn as HTMLElement).click();
            setTimeout(() => {
              const panel = document.querySelector('[data-tour="config-panel"]');
              if (panel) {
                panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
            }, 100);
          }
        }
      }
      
      // Navigate back to builder when showing builder-specific steps (if not already there)
      if ((currentStep?.target === '[data-tour="steps-panel"]' || 
          currentStep?.target === '[data-tour="show-config-button"]' ||
          currentStep?.target === '[data-tour="config-panel"]' ||
          currentStep?.target === '[data-tour="add-instrument-button"]' ||
          currentStep?.target === '[data-tour="undo-button"]' ||
          currentStep?.target === '[data-tour="flow-dropdown"]' ||
          currentStep?.target === '[data-tour="gen-code-button"]' ||
          currentStep?.target === '[data-tour="help-dropdown"]') && action === 'next') {
        setTimeout(() => {
          const builderBtn = document.querySelector('[data-tour="builder-button"]');
          if (builderBtn && !(builderBtn as HTMLElement).classList.contains('bg-blue-600')) {
            (builderBtn as HTMLElement).click();
          }
        }, 300);
      }
    }
    
    // Handle errors - if target not found, ensure we can continue
    // Joyride handles missing targets gracefully, but we ensure navigation works
    if (status === STATUS.ERROR) {
      const errorStep = steps[index];
      console.warn(`Tour step error at index ${index}, target: ${errorStep?.target}`);
      // Try to continue if possible
      if (action === 'next' && index + 1 < steps.length) {
        // The tour should continue automatically, but we ensure navigation is correct
        const nextStep = steps[index + 1];
        if (nextStep?.target === '[data-tour="builder-button"]') {
          setTimeout(() => {
            const builderBtn = document.querySelector('[data-tour="builder-button"]');
            if (builderBtn) {
              (builderBtn as HTMLElement).click();
            }
          }, 300);
        }
      }
    }
    
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      onComplete();
    }
  };

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous={true}
      showProgress={true}
      showSkipButton={true}
      callback={handleJoyrideCallback}
      disableScrolling={false}
      disableOverlayClose={false}
      spotlightClicks={false}
      styles={{
        options: {
          primaryColor: '#1cb5d8', // Tek blue
          zIndex: 10000,
        },
        tooltip: {
          borderRadius: 8,
        },
        buttonNext: {
          backgroundColor: '#1cb5d8',
          fontSize: '14px',
          padding: '8px 16px',
        },
        buttonBack: {
          color: '#6b7280',
          fontSize: '14px',
          padding: '8px 16px',
        },
        buttonSkip: {
          color: '#6b7280',
          fontSize: '14px',
        },
      }}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish',
        next: 'Next',
        skip: 'Skip tour',
      }}
    />
  );
};

