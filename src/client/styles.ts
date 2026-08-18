/** Scoped styles for the dsh-imagen generation card. */

export const IMAGEN_STYLES = `
.dshImagen {
  --ig-ratio: 1;
  border: 1px solid var(--ds-inline-border, rgba(127, 127, 127, 0.25));
  border-radius: 12px;
  overflow: hidden;
  background: var(--ds-inline-bg, rgba(127, 127, 127, 0.06));
  font-size: 13px;
  line-height: 1.45;
}
.dshImagen[data-state='error'] { border-color: rgba(220, 60, 60, 0.5); }
.dshImagen__header {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
}
.dshImagen__mark { display: inline-flex; color: var(--ds-accent, #7aa2f7); }
.dshImagen__heading { flex: 1; min-width: 0; }
.dshImagen__title { font-weight: 600; }
.dshImagen__subtitle { color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); font-size: 12px; }
.dshImagen__state { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); white-space: nowrap; }
.dshImagen__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ds-accent, #7aa2f7); }
.dshImagen[data-state='running'] .dshImagen__dot { animation: dshImagenPulse 1.2s ease-in-out infinite; }
.dshImagen[data-state='error'] .dshImagen__dot { background: rgba(220, 60, 60, 0.85); }
.dshImagen[data-state='done'] .dshImagen__dot { background: rgba(80, 190, 120, 0.9); }
@keyframes dshImagenPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.dshImagen__stage {
  position: relative; margin: 0 12px;
  aspect-ratio: var(--ig-ratio);
  max-height: 420px;
  border-radius: 8px;
  overflow: hidden;
  background:
    radial-gradient(circle at 30% 30%, rgba(122, 162, 247, 0.14), transparent 55%),
    radial-gradient(circle at 70% 70%, rgba(122, 162, 247, 0.08), transparent 55%),
    rgba(0, 0, 0, 0.18);
  display: flex; align-items: center; justify-content: center;
}
.dshImagen__image { width: 100%; height: 100%; object-fit: contain; display: block; }
.dshImagen__scan {
  position: absolute; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--ds-accent, #7aa2f7), transparent);
  animation: dshImagenScan 1.6s linear infinite;
  top: 0;
}
@keyframes dshImagenScan { 0% { top: 4%; opacity: 0.2; } 50% { opacity: 1; } 100% { top: 94%; opacity: 0.2; } }
.dshImagen__orb {
  position: absolute; width: 44px; height: 44px; border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--ds-accent, #7aa2f7);
  border-right-color: var(--ds-accent, #7aa2f7);
  animation: dshImagenSpin 1s linear infinite;
  filter: drop-shadow(0 0 6px rgba(122, 162, 247, 0.5));
}
@keyframes dshImagenSpin { to { transform: rotate(360deg); } }
.dshImagen__draft {
  position: absolute; left: 8px; bottom: 8px;
  padding: 2px 8px; border-radius: 999px;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 11px;
  backdrop-filter: blur(4px);
}
.dshImagen__error {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 16px; text-align: center; color: rgba(220, 80, 80, 0.95);
  background: rgba(0, 0, 0, 0.35);
}
.dshImagen__footer { padding: 10px 12px 12px; }
.dshImagen__prompt { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-bottom: 8px; color: var(--ds-text, inherit); }
.dshImagen__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.dshImagen__chip {
  padding: 2px 8px; border-radius: 999px; font-size: 11px;
  background: var(--ds-inline-bg, rgba(127, 127, 127, 0.12));
  color: var(--ds-text-muted, rgba(127, 127, 127, 0.85));
  white-space: nowrap;
}
.dshImagen__saved { max-width: 100%; }
.dshImagen__actions { display: inline-flex; gap: 6px; margin-left: auto; }
.dshImagen__button {
  padding: 4px 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--ds-inline-border, rgba(127, 127, 127, 0.3));
  background: var(--ds-inline-bg, rgba(127, 127, 127, 0.1));
  color: inherit;
}
.dshImagen__button:hover { filter: brightness(1.1); }
.dshImagen__gallery { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.dshImagen__thumb { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; cursor: pointer; border: 1px solid var(--ds-inline-border, rgba(127, 127, 127, 0.25)); }
.dshImagen__details { margin-top: 8px; }
.dshImagen__details summary { cursor: pointer; color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); font-size: 12px; }
.dshImagen__details p { margin: 6px 0 0; font-size: 12px; color: var(--ds-text-muted, rgba(127, 127, 127, 0.85)); white-space: pre-wrap; word-break: break-word; }
.dshImagen__lightbox {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.8);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  padding: 24px;
}
.dshImagen__lightbox img { max-width: 92vw; max-height: 82vh; object-fit: contain; border-radius: 8px; }
@media (prefers-reduced-motion: reduce) {
  .dshImagen__scan, .dshImagen__orb, .dshImagen__dot { animation: none !important; }
}
`

/** Scoped styles for the Settings → imagen page. */
export const IMAGEN_SETTINGS_STYLES = `
.dshImagenSet__page { max-width: 760px; display: flex; flex-direction: column; gap: 14px; font-size: 13px; }
.dshImagenSet__heading { margin: 0; font-size: 18px; font-weight: 600; }
.dshImagenSet__intro { margin: 0; color: var(--ds-text-muted, rgba(127,127,127,.85)); }
.dshImagenSet__group { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid var(--ds-inline-border, rgba(127,127,127,.25)); border-radius: 10px; background: var(--ds-inline-bg, rgba(127,127,127,.05)); }
.dshImagenSet__groupTitle { margin: 0; font-size: 14px; font-weight: 600; }
.dshImagenSet__sourceCard { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px dashed var(--ds-inline-border, rgba(127,127,127,.35)); border-radius: 8px; }
.dshImagenSet__sourceRow { display: flex; gap: 10px; flex-wrap: wrap; }
.dshImagenSet__field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 180px; }
.dshImagenSet__label { font-size: 12px; color: var(--ds-text-muted, rgba(127,127,127,.85)); }
.dshImagenSet__hint { font-size: 11px; color: var(--ds-text-muted, rgba(127,127,127,.7)); }
.dshImagenSet__input {
  padding: 6px 8px; border-radius: 6px; font-size: 13px;
  border: 1px solid var(--ds-inline-border, rgba(127,127,127,.35));
  background: var(--ds-inline-bg, rgba(127,127,127,.08));
  color: inherit;
}
.dshImagenSet__input:focus { outline: 2px solid var(--ds-accent, #7aa2f7); outline-offset: 0; }
.dshImagenSet__check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dshImagenSet__button {
  align-self: flex-start; padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;
  border: 1px solid var(--ds-inline-border, rgba(127,127,127,.35));
  background: var(--ds-inline-bg, rgba(127,127,127,.1)); color: inherit;
}
.dshImagenSet__button:hover:not(:disabled) { filter: brightness(1.1); }
.dshImagenSet__button:disabled { opacity: .5; cursor: default; }
.dshImagenSet__danger {
  align-self: flex-start; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;
  border: 1px solid rgba(220,80,80,.4); background: transparent; color: rgba(220,80,80,.9);
}
.dshImagenSet__actions { display: flex; align-items: center; gap: 10px; }
.dshImagenSet__ok { color: rgba(80,190,120,.95); font-size: 12px; }
.dshImagenSet__error { color: rgba(220,80,80,.95); font-size: 12px; }
`
