"use client";

/* Lightweight frame-rate + renderer readout for the 3D stage legend.
   Reports the actual GL renderer (SwiftShader vs hardware) so software
   measurements are never mistaken for hardware performance. */

import { useEffect, useState } from "react";

export default function FpsMeter() {
  const [fps, setFps] = useState<number | null>(null);
  const [renderer, setRenderer] = useState<string>("");

  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      const name = ext
        ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : "unknown renderer";
      setRenderer(/swiftshader|llvmpipe|software/i.test(name) ? "software GL" : "hardware GL");
    } catch {
      setRenderer("");
    }
    let frames = 0;
    let start = performance.now();
    let alive = true;
    let raf = 0;
    const loop = () => {
      if (!alive) return;
      frames += 1;
      const now = performance.now();
      if (now - start >= 2000) {
        setFps(Math.round((frames * 1000) / (now - start)));
        frames = 0;
        start = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  if (fps == null) return null;
  return (
    <span className="text-nx-muted" title="Measured frame rate on this machine">
      {fps} fps{renderer ? ` · ${renderer}` : ""}
    </span>
  );
}
