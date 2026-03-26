import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { publicAssetUrl } from '../utils/publicUrl';

export type TriggerAnimation = 
  | 'idle' 
  | 'hover' 
  | 'click' 
  | 'success' 
  | 'error' 
  | 'thinking' 
  | 'wave'
  | 'celebrate'
  | 'connecting'
  | 'processing'
  | 'save'
  | 'tour'
  | 'search'
  | 'write'
  | 'query'
  | 'disconnect'
  | 'sleep'
  | 'codegen'
  | 'tickle'
  | 'goodbye';

interface TriggerMascotProps {
  animation?: TriggerAnimation;
  onAnimationComplete?: () => void;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  size?: 'small' | 'medium' | 'large';
  className?: string;
  errorMessage?: string;
  onHide?: () => void;
}

export const TriggerMascot: React.FC<TriggerMascotProps> = ({
  animation = 'idle',
  onAnimationComplete,
  position = 'bottom-right',
  size = 'medium',
  className = '',
  errorMessage,
  onHide,
}) => {
  const [idleSvg, setIdleSvg] = useState<string>('');
  const [overlaySvg, setOverlaySvg] = useState<string>('');
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [isHiding, setIsHiding] = useState(false);
  const [localAnimation, setLocalAnimation] = useState<TriggerAnimation | null>(null);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  
  // Mouse movement tracking for tickle effect
  const fastMoveCount = useRef<number>(0);
  const lastMoveTime = useRef<number>(0);
  const lastMovePos = useRef<{ x: number; y: number } | null>(null);
  const lastTickleTime = useRef<number>(0);
  const tickleCheckInterval = useRef<NodeJS.Timeout>();
  
  // Check if mascot has already done its entrance animation
  const [isEntering, setIsEntering] = useState(() => {
    try {
      const hasSeenEntrance = localStorage.getItem('tekautomate_mascot_entrance_shown');
      return !hasSeenEntrance; // Only enter if we haven't seen it before
    } catch (e) {
      return true; // Default to showing entrance if localStorage fails
    }
  });
  const timeoutRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Load idle SVG once on mount
  useEffect(() => {
    fetch(publicAssetUrl('mascot/trigger-idle.svg'))
      .then(res => res.text())
      .then(text => setIdleSvg(text))
      .catch(err => {
        console.error('Failed to load idle SVG:', err);
      });
  }, []);

  // Determine effective animation (local overrides prop when set)
  const effectiveAnimation = localAnimation || animation;

  // Handle animation changes - SIMPLE VERSION
  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // If idle, clear overlay
    if (effectiveAnimation === 'idle') {
      setOverlaySvg('');
      return;
    }

    // Load the animation SVG
    fetch(publicAssetUrl(`mascot/trigger-${effectiveAnimation}.svg`))
      .then(res => {
        if (!res.ok) throw new Error(`SVG not found: trigger-${effectiveAnimation}.svg`);
        return res.text();
      })
      .then(text => {
        setOverlaySvg(text);
        
        const duration = getAnimationDuration(effectiveAnimation);
        
        // Continuous animations don't auto-reset
        if (duration === 0) {
          return;
        }
        
        // Set timeout to clear overlay after duration
        timeoutRef.current = setTimeout(() => {
          setOverlaySvg('');
          setLocalAnimation(null);
          
          // If hiding, actually hide after goodbye animation
          if (isHiding) {
            setIsHiding(false);
            onHide?.();
          } else {
          onAnimationComplete?.();
          }
        }, duration);
      })
      .catch(err => {
        console.warn(`Animation "${effectiveAnimation}" not available:`, err.message);
        setOverlaySvg('');
        setLocalAnimation(null);
      });
  }, [effectiveAnimation, onAnimationComplete, isHiding, onHide]);

  // Cleanup
  useEffect(() => {
    // Copy ref value at effect creation time for cleanup
    const intervalRef = tickleCheckInterval.current;
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Use the captured ref value
      if (intervalRef) {
        clearInterval(intervalRef);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle mouse movement for tickle - count rapid movements over time
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const now = Date.now();
    const currentPos = { x: e.clientX, y: e.clientY };
    
    // If too much time passed since last move, reset count
    if (now - lastMoveTime.current > 200) {
      fastMoveCount.current = 0;
    }
    
    // Calculate speed if we have a previous position
    if (lastMovePos.current && now - lastMoveTime.current < 100) {
      const dx = currentPos.x - lastMovePos.current.x;
      const dy = currentPos.y - lastMovePos.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const timeDiff = now - lastMoveTime.current;
      const speed = timeDiff > 0 ? distance / timeDiff : 0;
      
      // If moving fast (> 0.5 pixels/ms), increment counter
      if (speed > 0.5) {
        fastMoveCount.current++;
      }
      
      // Trigger tickle after ~25 fast movements (about 2 seconds of fast movement)
      // and if we haven't tickled in the last 8 seconds
      if (fastMoveCount.current >= 25 && now - lastTickleTime.current > 8000 && !localAnimation) {
        lastTickleTime.current = now;
        fastMoveCount.current = 0;
        setLocalAnimation('tickle');
      }
    }
    
    lastMoveTime.current = now;
    lastMovePos.current = currentPos;
  }, [localAnimation]);

  // Handle right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuVisible(true);
  }, []);

  // Handle hide with goodbye animation
  const handleHide = useCallback(() => {
    setContextMenuVisible(false);
    setIsHiding(true);
    setLocalAnimation('goodbye');
  }, []);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    if (!contextMenuVisible) return;
    
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is inside context menu
      if (target.closest('[data-mascot-menu]')) {
        return;
      }
      setContextMenuVisible(false);
    };
    
    // Small delay to avoid closing immediately from the same right-click
    const timer = setTimeout(() => {
      window.addEventListener('click', handleClick, true);
      window.addEventListener('contextmenu', handleClick, true);
    }, 50);
    
    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('contextmenu', handleClick, true);
    };
  }, [contextMenuVisible]);

  const sizeClasses = {
    small: 'w-16 h-16',
    medium: 'w-24 h-24',
    large: 'w-32 h-32',
  };

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Only play entrance animation if isEntering is true (first time)
    if (isEntering) {
      const entranceTimeout = setTimeout(() => {
        setIsEntering(false);
        // Mark that we've seen the entrance animation
        try {
          localStorage.setItem('tekautomate_mascot_entrance_shown', 'true');
        } catch (e) {
          console.error('Failed to save mascot entrance flag:', e);
        }
      }, 6000);
      return () => clearTimeout(entranceTimeout);
    }
  }, [isEntering]);

  const hasOverlay = overlaySvg !== '';

  const getFinalPosition = () => {
    switch (position) {
      case 'bottom-right':
        return { bottom: '120px', right: '185px' };
      case 'bottom-left':
        return { bottom: '80px', left: '20px' };
      case 'top-right':
        return { top: '20px', right: '20px' };
      case 'top-left':
        return { top: '20px', left: '20px' };
      default:
        return { bottom: '120px', right: '185px' };
    }
  };

  const getPositionStyle = () => {
    const baseStyle: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
      pointerEvents: 'auto',
      filter: 'drop-shadow(0 4px 6px rgba(0, 0, 0, 0.1))',
    };

    if (isEntering) {
      const finalPos = getFinalPosition();
      return {
        ...baseStyle,
        animation: 'triggerFlyIn 6s linear forwards',
        ...(finalPos.bottom && { '--final-bottom': finalPos.bottom }),
        ...(finalPos.right && { '--final-right': finalPos.right }),
        ...(finalPos.top && { '--final-top': finalPos.top }),
        ...(finalPos.left && { '--final-left': finalPos.left }),
      } as React.CSSProperties;
    }

    const finalPos = getFinalPosition();
    return { 
      ...baseStyle, 
      ...finalPos,
      transform: 'scale(1) rotate(0deg)', 
      opacity: 1, 
      transition: 'all 0.3s ease' 
    };
  };

  const mascotContent = (
    <>
    <div
        ref={containerRef}
        className={`${sizeClasses[size]} ${className} cursor-pointer relative`}
      style={getPositionStyle()}
        onMouseMove={handleMouseMove}
        onContextMenu={handleContextMenu}
    >
      {/* Base Layer - Idle Animation (only show when no overlay) */}
      {!hasOverlay && idleSvg && (
        <div
          className="absolute inset-0 trigger-base-layer"
          dangerouslySetInnerHTML={{ __html: idleSvg }}
        />
      )}

      {/* Overlay Layer - Event Animations */}
      {hasOverlay && (
        <div
          className="absolute inset-0 trigger-overlay-layer"
          dangerouslySetInnerHTML={{ __html: overlaySvg }}
          />
        )}

        {/* Error Message Bubble */}
        {effectiveAnimation === 'error' && errorMessage && (
          <div
            className="absolute -top-16 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs px-3 py-2 rounded-lg shadow-lg whitespace-nowrap animate-bounce"
            style={{ 
              minWidth: '120px', 
              maxWidth: '250px',
              whiteSpace: 'normal',
              textAlign: 'center',
              zIndex: 10000,
              pointerEvents: 'none'
            }}
          >
            {errorMessage}
            <div 
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0"
              style={{
                borderLeft: '8px solid transparent',
                borderRight: '8px solid transparent',
                borderTop: '8px solid #dc2626',
              }}
        />
          </div>
      )}
    </div>

      {/* Context Menu */}
      {contextMenuVisible && (
        <div
          data-mascot-menu
          className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[10001]"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            onClick={handleHide}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
          >
            <span>👋</span>
            <span>Hide Mascot</span>
          </button>
        </div>
      )}
    </>
  );

  if (!mounted) return null;
  return createPortal(mascotContent, document.body);
};

function getAnimationDuration(animation: TriggerAnimation): number {
  const durations: Record<TriggerAnimation, number> = {
    idle: 0,
    hover: 2000,
    click: 1000,
    success: 4000,
    error: 4000,
    thinking: 6000,
    wave: 4000,
    celebrate: 6000,
    connecting: 3000,
    processing: 3000,
    save: 3000,
    tour: 0,
    search: 3000,
    write: 3000,
    query: 3000,
    disconnect: 3000,
    sleep: 3000,
    codegen: 0, // Continuous animation
    tickle: 2500,
    goodbye: 3000,
  };
  return durations[animation] || 4000;
}

export const useTriggerMascot = () => {
  const [animation, setAnimation] = useState<TriggerAnimation>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const triggerAnimation = (anim: TriggerAnimation, message?: string) => {
    setAnimation(anim);
    if (anim === 'error' && message) {
      setErrorMessage(message);
    } else if (anim !== 'error') {
      setErrorMessage(undefined);
    }
  };

  return {
    animation,
    errorMessage,
    triggerAnimation,
    celebrate: () => triggerAnimation('celebrate'),
    success: () => triggerAnimation('success'),
    error: (message?: string) => triggerAnimation('error', message),
    thinking: () => triggerAnimation('thinking'),
    wave: () => triggerAnimation('wave'),
    click: () => triggerAnimation('click'),
    hover: () => triggerAnimation('hover'),
    connecting: () => triggerAnimation('connecting'),
    processing: () => triggerAnimation('processing'),
    save: () => triggerAnimation('save'),
    tour: () => triggerAnimation('tour'),
    search: () => triggerAnimation('search'),
    write: () => triggerAnimation('write'),
    query: () => triggerAnimation('query'),
    disconnect: () => triggerAnimation('disconnect'),
    sleep: () => triggerAnimation('sleep'),
    codegen: () => triggerAnimation('codegen'),
    tickle: () => triggerAnimation('tickle'),
    goodbye: () => triggerAnimation('goodbye'),
  };
};
