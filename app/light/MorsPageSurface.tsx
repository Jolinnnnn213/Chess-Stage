import type { CSSProperties, Ref } from "react";
import { COLOR_PRESETS, INITIAL_LIGHT, type LightingSettings } from "./config";

export type StageMode = "SCATTERED" | "UPRIGHT" | "WHITE FORMATION" | "BLACK FORMATION" | "DUEL" | "HUNT COMPLETE";

const DISCOVERY_ORDER = ["KING", "QUEEN", "BISHOP", "KNIGHT", "ROOK", "PAWN"];

type MorsPageSurfaceProps = {
  lighting: LightingSettings;
  awakenedCount: number;
  pieceTotal: number;
  discoveredPieces: string[];
  combo: number;
  finaleActive: boolean;
  activePiece: string;
  stageMode: StageMode;
  onLightingChange: (patch: Partial<LightingSettings>) => void;
  onReset: () => void;
  preview?: boolean;
  sourceRef?: Ref<HTMLDivElement>;
};

export function MorsPageSurface({
  lighting,
  awakenedCount,
  pieceTotal,
  discoveredPieces,
  combo,
  finaleActive,
  activePiece,
  stageMode,
  onLightingChange,
  onReset,
  preview = false,
  sourceRef,
}: MorsPageSurfaceProps) {
  const tabIndex = preview ? -1 : undefined;
  const complete = discoveredPieces.length === pieceTotal;
  const regularDiscoveries = discoveredPieces.filter((piece) => piece !== "secret").length;
  const secretUnlocked = regularDiscoveries >= pieceTotal - 1;
  const visibleTotal = secretUnlocked ? pieceTotal : pieceTotal - 1;

  return (
    <div
      ref={sourceRef}
      className="page-source chess-surface"
      style={{ "--lamp-color": lighting.color } as CSSProperties}
    >
      <header className="page-header">
        <div className="page-brand">
          <span className="page-logo-wrap"><b>JL</b></span>
          <span>CHESS STAGE</span>
          <span className="page-brand-suffix">AN INTERACTIVE LIGHT STUDY</span>
        </div>
        <div className="page-status"><span /> {lighting.enabled ? "LIGHT ACTIVE" : "LIGHT SLEEPING"}</div>
      </header>

      <div className="stage-copy" aria-live="polite">
        <p className="page-kicker">JOLIN LI / EXPERIMENT 01</p>
        <h1>MOVE THE LIGHT.<br /><span>WAKE THE BOARD.</span></h1>
        <p className="stage-intro">
          Search beyond the center. Hold the beam to discover each piece before darkness returns it to rest.
        </p>
        <div className="stage-readout">
          <div><span>AWAKE</span><b>{String(awakenedCount).padStart(2, "0")} / {String(visibleTotal).padStart(2, "0")}</b></div>
          <div><span>DISCOVERED</span><b>{String(discoveredPieces.length).padStart(2, "0")} / {String(visibleTotal).padStart(2, "0")}</b></div>
          <div><span>LAST MOVEMENT</span><b>{activePiece || "WAITING FOR LIGHT"}</b></div>
        </div>
        <div className={`discovery-grid${secretUnlocked ? " has-secret" : ""}`} aria-label={`${discoveredPieces.length} of ${visibleTotal} visible discoveries found`}>
          {DISCOVERY_ORDER.map((piece, index) => {
            const found = discoveredPieces.includes(piece.toLowerCase());
            return <div key={piece} className={found ? "is-found" : ""}>
              <span>0{index + 1}</span><b>{piece}</b><i />
            </div>;
          })}
          {secretUnlocked ? <div className={`secret-slot${discoveredPieces.includes("secret") ? " is-found" : ""}`}>
            <span>07</span><b>{discoveredPieces.includes("secret") ? "SECRET" : "???"}</b><i />
          </div> : null}
        </div>
        <div className={`hunt-signal${combo > 1 ? " is-combo" : ""}${finaleActive ? " is-finale" : ""}`}>
          {finaleActive ? "LIGHT HUNT COMPLETE · FINALE ACTIVE" : combo > 1 ? `DISCOVERY COMBO ×${combo}` : complete ? "COLLECTION COMPLETE" : secretUnlocked ? "FINAL SIGNAL DETECTED · LOOK ABOVE" : `${stageMode} · KEEP SEARCHING`}
        </div>
      </div>

      <aside className="light-controls stage-controls" data-interactive aria-label="Spotlight controls">
        <div className="control-heading">
          <div><p>LIGHT CONTROL</p><span>PHYSICAL SPOT / 01</span></div>
          <button
            type="button"
            className={`power-toggle${lighting.enabled ? " is-on" : ""}`}
            onClick={() => onLightingChange({ enabled: !lighting.enabled })}
            aria-pressed={lighting.enabled}
            aria-label={lighting.enabled ? "Turn spotlight off" : "Turn spotlight on"}
            tabIndex={tabIndex}
          ><span />{lighting.enabled ? "ON" : "OFF"}</button>
        </div>

        <label className="control-row">
          <span className="control-label"><b>BEAM WIDTH</b><output>{lighting.angle}°</output></span>
          <input type="range" min="16" max="58" step="1" value={lighting.angle}
            onInput={(event) => onLightingChange({ angle: Number(event.currentTarget.value) })}
            aria-label="Spotlight beam angle" tabIndex={tabIndex} />
        </label>

        <label className="control-row">
          <span className="control-label"><b>WAKE FORCE</b><output>{lighting.brightness} lm</output></span>
          <input type="range" min="300" max="2600" step="50" value={lighting.brightness}
            onInput={(event) => onLightingChange({ brightness: Number(event.currentTarget.value) })}
            aria-label="Spotlight brightness" tabIndex={tabIndex} />
        </label>

        <div className="control-row color-control">
          <span className="control-label"><b>LIGHT COLOR</b><output>{lighting.color.toUpperCase()}</output></span>
          <div className="color-options">
            {COLOR_PRESETS.map((color) => (
              <button key={color} type="button" className={lighting.color === color ? "is-active" : ""}
                style={{ "--swatch": color } as CSSProperties}
                onClick={() => onLightingChange({ color })} aria-label={`Set light color to ${color}`}
                aria-pressed={lighting.color === color} tabIndex={tabIndex} />
            ))}
            <label className="custom-color" aria-label="Choose a custom light color">
              <input type="color" value={lighting.color}
                onInput={(event) => onLightingChange({ color: event.currentTarget.value })} tabIndex={tabIndex} />
              <span>+</span>
            </label>
          </div>
        </div>

        <button type="button" className="reset-light" onClick={onReset} tabIndex={tabIndex}>
          RESET STAGE <span>↗</span>
        </button>
      </aside>

      <footer className="page-footer">
        <p>{secretUnlocked ? "ONE FINAL SIGNAL → LOOK ABOVE" : "FIND 6 PIECES → COMPLETE THE HUNT"}</p>
        <div className="drag-instruction">
          <span className="drag-orbit" aria-hidden="true"><i /></span>
          <div><b>LMB PULL · RELEASE TO SWING</b><span>RMB drag beam · RMB click color · Double-click reset</span></div>
        </div>
        <p>DESIGN · TECHNOLOGY · PLAY</p>
      </footer>
    </div>
  );
}

const ignoreLightingChange = () => {};
const ignoreReset = () => {};

export function MorsLightPreview({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className={`scene-preview${hidden ? " is-hidden" : ""}`} aria-hidden="true" inert>
      <MorsPageSurface lighting={INITIAL_LIGHT} awakenedCount={0} pieceTotal={7} discoveredPieces={[]}
        combo={0} finaleActive={false} activePiece="" stageMode="SCATTERED"
        onLightingChange={ignoreLightingChange} onReset={ignoreReset} preview />
    </div>
  );
}

export function MorsLightLoading() {
  return (
    <main className="experience-shell" aria-label="Awaken the Pieces interactive chess stage">
      <MorsLightPreview />
      <div className="scene-status" aria-live="polite"><span /> LOADING CHESS STAGE</div>
    </main>
  );
}
