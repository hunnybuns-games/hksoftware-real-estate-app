"use client";

import { useRef, useState } from "react";

/**
 * A freehand signature pad: draw with mouse, pen, or touch, and the result is
 * serialized into a hidden `<input>` as a PNG data URL so it rides along with
 * an ordinary form submission — no client-side upload step, no extra request.
 *
 * Deliberately dependency-free (no signature-pad library): this is a few
 * dozen lines of canvas + pointer events, well within what's worth writing by
 * hand rather than pulling in a package for.
 *
 * Drawing is optional everywhere this is used — the typed name alongside it
 * is what the audit trail actually relies on (see src/actions/lease-documents.ts)
 * — so an empty pad just submits an empty hidden field.
 */
export function SignaturePad({ name }: { name: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);

  function ctx(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext("2d") ?? null;
  }

  function pointFromEvent(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // Canvas backing store is scaled by devicePixelRatio (see the ref
    // callback below), so map the CSS-pixel event position into that space.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const c = ctx();
    const from = lastPointRef.current;
    const to = pointFromEvent(e);
    if (!c || !from) return;
    c.strokeStyle = "#1e293b";
    c.lineWidth = 3;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.lineTo(to.x, to.y);
    c.stroke();
    lastPointRef.current = to;
    setHasDrawing(true);
  }

  function handlePointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
    if (hiddenInputRef.current && canvasRef.current) {
      hiddenInputRef.current.value = canvasRef.current.toDataURL("image/png");
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const c = ctx();
    if (canvas && c) c.clearRect(0, 0, canvas.width, canvas.height);
    if (hiddenInputRef.current) hiddenInputRef.current.value = "";
    setHasDrawing(false);
  }

  return (
    <div>
      <div className="relative rounded-lg border border-slate-300 bg-white touch-none">
        <canvas
          ref={(el) => {
            canvasRef.current = el;
            if (el && el.width === 0) {
              // Render the backing store at device pixel resolution so
              // strokes stay crisp, while CSS keeps the on-page size fixed.
              const dpr = window.devicePixelRatio || 1;
              const cssWidth = el.clientWidth || 500;
              const cssHeight = 140;
              el.width = cssWidth * dpr;
              el.height = cssHeight * dpr;
              el.style.height = `${cssHeight}px`;
            }
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="block w-full cursor-crosshair rounded-lg"
        />
        {!hasDrawing ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">
            Draw your signature here
          </p>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <p className="hint">Optional — your typed name below is what&apos;s on file either way.</p>
        <button
          type="button"
          onClick={clear}
          disabled={!hasDrawing}
          className="text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
      <input ref={hiddenInputRef} type="hidden" name={name} />
    </div>
  );
}
