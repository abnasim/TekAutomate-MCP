import React, { useEffect, useMemo, useRef, useState } from 'react';
import RFB from '../../vendor/novnc/lib/rfb.js';

interface VncViewerProps {
  wsUrl: string;
  title?: string;
}

type ViewerState = {
  title: string;
  message: string;
  visible: boolean;
};

const CONNECTING_STATE: ViewerState = {
  title: 'Connecting VNC...',
  message: 'Starting the noVNC session.',
  visible: true,
};

export function VncViewer({ wsUrl, title = 'Scope VNC Viewer' }: VncViewerProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<any>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const [viewerState, setViewerState] = useState<ViewerState>(CONNECTING_STATE);

  const overlayHiddenClass = useMemo(
    () => (viewerState.visible ? '' : 'hidden'),
    [viewerState.visible]
  );

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return undefined;

    let disposed = false;

    const clearConnectTimeout = () => {
      if (connectTimeoutRef.current !== null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
    };

    const postToParent = (payload: Record<string, unknown>) => {
      window.parent.postMessage({ source: 'tekautomate-vnc', ...payload }, '*');
    };

    const showState = (next: ViewerState) => {
      if (disposed) return;
      setViewerState(next);
    };

    const start = async () => {
      showState(CONNECTING_STATE);

      try {
        const rfb = new RFB(screen, wsUrl, { shared: true });
        rfbRef.current = rfb;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.clipViewport = false;
        rfb.qualityLevel = 6;
        rfb.compressionLevel = 2;
        rfb.focusOnClick = true;
        rfb.background = 'rgb(2, 6, 23)';

        connectTimeoutRef.current = window.setTimeout(() => {
          if (disposed) return;
          const message = 'The embedded viewer did not complete the noVNC handshake within 5 seconds.';
          showState({
            title: 'VNC connection timed out',
            message,
            visible: true,
          });
          postToParent({ type: 'error', message });
        }, 5000);

        rfb.addEventListener('connect', () => {
          clearConnectTimeout();
          if (disposed) return;
          showState({
            title: '',
            message: '',
            visible: false,
          });
          postToParent({ type: 'connected' });
        });

        rfb.addEventListener('disconnect', (event: any) => {
          clearConnectTimeout();
          if (disposed) return;
          const clean = Boolean(event?.detail?.clean);
          showState({
            title: clean ? 'VNC disconnected' : 'VNC connection lost',
            message: clean ? 'The session ended cleanly.' : 'The viewer lost its connection to the executor bridge.',
            visible: true,
          });
          postToParent({ type: 'disconnected', clean });
        });

        rfb.addEventListener('credentialsrequired', () => {
          clearConnectTimeout();
          const password = window.prompt('Enter VNC password for this scope:', '') || '';
          if (!password) {
            showState({
              title: 'Password required',
              message: 'The scope requested a VNC password. Reconnect when you are ready.',
              visible: true,
            });
            return;
          }
          rfb.sendCredentials({ password });
        });

        rfb.addEventListener('securityfailure', (event: any) => {
          clearConnectTimeout();
          const reason = String(event?.detail?.reason || 'Security negotiation failed.');
          showState({
            title: 'VNC security failure',
            message: reason,
            visible: true,
          });
          postToParent({ type: 'error', message: reason });
        });
      } catch (error) {
        clearConnectTimeout();
        const message = error instanceof Error ? error.message : String(error);
        showState({
          title: 'Failed to start VNC',
          message,
          visible: true,
        });
        postToParent({ type: 'error', message });
      }
    };

    void start();

    return () => {
      disposed = true;
      clearConnectTimeout();
      try {
        rfbRef.current?.disconnect?.();
      } catch (_) {}
      rfbRef.current = null;
      if (screenRef.current) {
        screenRef.current.innerHTML = '';
      }
    };
  }, [wsUrl]);

  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-800">
      <div ref={screenRef} aria-label={title} className="h-full min-h-[24rem] w-full" />
      <div
        className={`absolute inset-0 flex items-center justify-center bg-[rgba(2,6,23,0.34)] backdrop-blur-[2px] ${overlayHiddenClass}`}
        style={{ pointerEvents: 'none' }}
      >
        <div className="max-w-[320px] rounded-[14px] border border-[rgba(148,163,184,0.28)] bg-[rgba(15,23,42,0.92)] px-[14px] py-3 text-[12px] leading-[1.5] text-slate-200 shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
          <strong className="mb-1 block text-[13px]">{viewerState.title}</strong>
          {viewerState.message}
        </div>
      </div>
    </div>
  );
}
