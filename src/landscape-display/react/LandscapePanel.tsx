import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from 'react';
import { LandscapeSceneController } from '../api/LandscapeSceneController.js';
import type { LandscapeSceneSnapshot } from '../api/types.js';

export interface LandscapePanelProps {
  snapshot: LandscapeSceneSnapshot;
  className?: string;
  style?: CSSProperties;
  onReady?: (controller: LandscapeSceneController) => void;
  onBackgroundError?: (error: Error) => void;
}

export interface LandscapePanelHandle {
  getController(): LandscapeSceneController | null;
  reload(snapshot: LandscapeSceneSnapshot): Promise<void>;
}

export const LandscapePanel = forwardRef<LandscapePanelHandle, LandscapePanelProps>(
  function LandscapePanel(
    { snapshot, className, style, onReady, onBackgroundError },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<LandscapeSceneController | null>(null);
    const onReadyRef = useRef(onReady);
    const onBackgroundErrorRef = useRef(onBackgroundError);
    const horizonBootRef = useRef(snapshot.horizonRatio);

    onReadyRef.current = onReady;
    onBackgroundErrorRef.current = onBackgroundError;

    useImperativeHandle(ref, () => ({
      getController: () => controllerRef.current,
      reload: async (next) => {
        const controller = controllerRef.current;
        if (!controller || controller.isDisposed()) {
          throw new Error('LandscapePanel is not ready.');
        }
        await controller.reloadScene(next);
      },
    }));

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      let cancelled = false;
      let resizeObserver: ResizeObserver | undefined;

      void LandscapeSceneController.create(el, snapshot, {
        onBackgroundError: (error) => onBackgroundErrorRef.current?.(error),
      })
        .then((controller) => {
          if (cancelled) {
            controller.dispose();
            return;
          }
          controllerRef.current = controller;
          onReadyRef.current?.(controller);

          resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry || controller.isDisposed()) return;
            const width = entry.contentRect.width;
            if (width > 0) {
              controller.resizeViewWindow(width);
            }
          });
          resizeObserver.observe(el);

          const width = el.getBoundingClientRect().width;
          if (width > 0) {
            controller.resizeViewWindow(width);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            onBackgroundErrorRef.current?.(
              error instanceof Error ? error : new Error(String(error)),
            );
          }
        });

      return () => {
        cancelled = true;
        resizeObserver?.disconnect();
        controllerRef.current?.dispose();
        controllerRef.current = null;
      };
    }, [snapshot.horizonRatio]);

    useEffect(() => {
      if (snapshot.horizonRatio === horizonBootRef.current) return;
      horizonBootRef.current = snapshot.horizonRatio;
    }, [snapshot.horizonRatio]);

    useEffect(() => {
      const controller = controllerRef.current;
      if (!controller || controller.isDisposed()) return;
      controller.setObjects(snapshot.objects);
    }, [snapshot.objects]);

    useEffect(() => {
      const controller = controllerRef.current;
      if (!controller || controller.isDisposed()) return;
      void controller.setBackground(snapshot.backgroundUrl).catch((error) => {
        onBackgroundErrorRef.current?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, [snapshot.backgroundUrl]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width: '100%',
          aspectRatio: '1 / 1',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
          ...style,
        }}
      />
    );
  },
);
