import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LandscapePanelHandle } from '../landscape-display/react/LandscapePanel';
import { LandscapePanel } from '../landscape-display/react/LandscapePanel';
import type { LandscapeSceneController } from '../landscape-display/api/LandscapeSceneController.js';
import type { LandscapeSceneState } from '../../shared/scene-agent-types.js';
import { defaultSceneState } from './default-scene';
import { applySceneControls, sceneStateToSnapshot } from './scene-state-bridge';
import SceneAgentPanel, { type SceneAgentResponse } from './SceneAgentPanel';
import './GameShell.css';

export default function GameShell() {
  const [sceneState, setSceneState] = useState<LandscapeSceneState>(defaultSceneState);
  const [landscapeError, setLandscapeError] = useState('');
  const panelRef = useRef<LandscapePanelHandle>(null);
  const controllerRef = useRef<LandscapeSceneController | null>(null);

  const snapshot = useMemo(() => sceneStateToSnapshot(sceneState), [sceneState]);

  const handleReady = useCallback(
    (controller: LandscapeSceneController) => {
      controllerRef.current = controller;
      applySceneControls(controller, sceneState);
    },
    [sceneState],
  );

  const handleAgentComplete = useCallback((response: SceneAgentResponse) => {
    setSceneState(response.sceneState);
  }, []);

  useEffect(() => {
    const controller = panelRef.current?.getController() ?? controllerRef.current;
    if (controller && !controller.isDisposed()) {
      applySceneControls(controller, sceneState);
    }
  }, [sceneState]);

  return (
    <main className="game-shell">
      <header className="game-shell__header">
        <h1>Lost History</h1>
        <p>Scene agent test — place catalog objects via function calling.</p>
      </header>

      <div className="game-shell__layout">
        <section className="game-shell__viewport" aria-label="Landscape view">
          <h2 className="game-shell__panel-title">Scene</h2>
          {landscapeError && <p className="game-shell__landscape-error">{landscapeError}</p>}
          <LandscapePanel
            ref={panelRef}
            snapshot={snapshot}
            onReady={handleReady}
            onBackgroundError={(err) => setLandscapeError(err.message)}
          />
        </section>

        <section className="game-shell__chat" aria-label="Scene agent">
          <h2 className="game-shell__panel-title">Scene agent</h2>
          <SceneAgentPanel
            sceneState={sceneState}
            onSceneStateChange={setSceneState}
            onAgentComplete={handleAgentComplete}
          />
        </section>
      </div>
    </main>
  );
}
