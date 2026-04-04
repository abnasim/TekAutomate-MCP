import React, { useMemo } from 'react';

interface VncViewerProps {
  wsUrl: string;
  title?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function VncViewer({ wsUrl, title = 'Scope VNC Viewer' }: VncViewerProps) {
  const srcDoc = useMemo(() => {
    const safeUrl = JSON.stringify(wsUrl);
    const safeTitle = escapeHtml(title);
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #020617;
        color: #e2e8f0;
        font-family: Inter, system-ui, sans-serif;
      }
      #root {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(59, 130, 246, 0.22), transparent 45%),
          linear-gradient(180deg, #020617 0%, #0f172a 100%);
      }
      #screen {
        width: 100%;
        height: 100%;
      }
      #overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        background: rgba(2, 6, 23, 0.34);
        backdrop-filter: blur(2px);
      }
      #status {
        border: 1px solid rgba(148, 163, 184, 0.28);
        background: rgba(15, 23, 42, 0.92);
        color: #e2e8f0;
        border-radius: 14px;
        padding: 12px 14px;
        font-size: 12px;
        line-height: 1.5;
        box-shadow: 0 16px 40px rgba(15, 23, 42, 0.35);
        max-width: 320px;
      }
      #status strong {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
      }
      .hidden {
        display: none !important;
      }
    </style>
  </head>
  <body>
    <div id="root">
      <div id="screen"></div>
      <div id="overlay">
        <div id="status"><strong>Connecting VNC…</strong>Starting the noVNC session.</div>
      </div>
    </div>
    <script type="module">
      import RFB from '/vendor/novnc/lib/rfb.js';

      const target = document.getElementById('screen');
      const overlay = document.getElementById('overlay');
      const status = document.getElementById('status');
      const wsUrl = ${safeUrl};
      let rfb = null;

      function showStatus(title, message) {
        overlay.classList.remove('hidden');
        status.innerHTML = '<strong>' + title + '</strong>' + message;
      }

      function hideStatus() {
        overlay.classList.add('hidden');
      }

      try {
        rfb = new RFB(target, wsUrl, { shared: true });
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.clipViewport = false;
        rfb.qualityLevel = 6;
        rfb.compressionLevel = 2;
        rfb.focusOnClick = true;
        rfb.background = 'rgb(2, 6, 23)';

        rfb.addEventListener('connect', () => {
          hideStatus();
          window.parent.postMessage({ source: 'tekautomate-vnc', type: 'connected' }, '*');
        });

        rfb.addEventListener('disconnect', (event) => {
          const clean = Boolean(event?.detail?.clean);
          showStatus(clean ? 'VNC disconnected' : 'VNC connection lost', clean ? 'The session ended cleanly.' : 'The viewer lost its connection to the executor bridge.');
          window.parent.postMessage({ source: 'tekautomate-vnc', type: 'disconnected', clean }, '*');
        });

        rfb.addEventListener('credentialsrequired', () => {
          const password = window.prompt('Enter VNC password for this scope:', '') || '';
          if (!password) {
            showStatus('Password required', 'The scope requested a VNC password. Reconnect when you are ready.');
            return;
          }
          rfb.sendCredentials({ password });
        });

        rfb.addEventListener('securityfailure', (event) => {
          const reason = event?.detail?.reason || 'Security negotiation failed.';
          showStatus('VNC security failure', String(reason));
          window.parent.postMessage({ source: 'tekautomate-vnc', type: 'error', message: String(reason) }, '*');
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        showStatus('Failed to start VNC', message);
        window.parent.postMessage({ source: 'tekautomate-vnc', type: 'error', message }, '*');
      }

      window.addEventListener('beforeunload', () => {
        try {
          rfb?.disconnect();
        } catch (_) {}
      });
    </script>
  </body>
</html>`;
  }, [title, wsUrl]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-800">
      <iframe
        title={title}
        srcDoc={srcDoc}
        className="block h-[calc(100vh-14rem)] min-h-[24rem] w-full border-0 bg-slate-950"
        sandbox="allow-scripts allow-same-origin allow-modals"
      />
    </div>
  );
}
