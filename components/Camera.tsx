"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  label?: string;
};

const MAX_SIDE = 720;

function toJpeg(source: CanvasImageSource, w: number, h: number, mirror: boolean): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Câmera frontal ao vivo; se o navegador não permitir, cai para o seletor nativo da câmera. */
export function Camera({ value, onChange, label = "Tirar foto" }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "live" | "fallback">("idle");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setStatus("fallback");
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setStatus("live");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setStatus("fallback");
    }
  }, []);

  useEffect(() => stop, [stop]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    onChange(toJpeg(v, v.videoWidth, v.videoHeight, true));
    stop();
    setStatus("idle");
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new window.Image();
    img.onload = () => {
      onChange(toJpeg(img, img.naturalWidth, img.naturalHeight, false));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    e.target.value = "";
  };

  if (value) {
    return (
      <div className="camera">
        <img src={value} alt="Foto capturada" className="camera__frame" />
        <button type="button" className="btn btn--ghost" onClick={() => { onChange(null); start(); }}>
          Tirar outra
        </button>
      </div>
    );
  }

  return (
    <div className="camera">
      {status === "live" || status === "starting" ? (
        <>
          <div className="camera__frame camera__frame--live">
            <video ref={videoRef} playsInline muted className="camera__video" />
            <div className="camera__oval" aria-hidden />
          </div>
          <button type="button" className="btn" onClick={capture} disabled={status !== "live"}>
            {status === "starting" ? "Abrindo câmera…" : "Capturar"}
          </button>
        </>
      ) : (
        <>
          <div className="camera__frame camera__placeholder" aria-hidden>
            <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          {status === "fallback" ? (
            <>
              <p className="hint">Não conseguimos abrir a câmera aqui. Toque abaixo para usar a câmera do celular.</p>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>{label}</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={start}>{label}</button>
          )}
        </>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
    </div>
  );
}
