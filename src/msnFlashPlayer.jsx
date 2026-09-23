import { useEffect, useRef, useState } from "react";
import { resolveMsnSwf } from "./msnFlashPolicy.js";

export default function MsnFlashPlayer({ src, poster, alt = "Animation MSN", className = "", style, muted = false, previewOnly = false, onReady, onError }) {
  const frame = useRef(null);
  const playback = useRef({ src, token: crypto.randomUUID(), initialMuted: muted });
  if (playback.current.src !== src) playback.current = { src, token: crypto.randomUUID(), initialMuted: muted };
  const audioMuted = useRef(muted);
  audioMuted.current = muted;
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const [error, setError] = useState("");
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const validSource = resolveMsnSwf(src, document.baseURI);
  const adapter = new URL("./msn-assets/flash-player/index.html", document.baseURI);
  const adapterOrigin = adapter.protocol === "file:" ? "null" : adapter.origin;
  if (validSource) {
    const msnBase = new URL("./msn-assets/msn75/", document.baseURI).href;
    adapter.searchParams.set("movie", validSource.slice(msnBase.length));
    adapter.searchParams.set("token", playback.current.token);
    adapter.searchParams.set("muted", muted ? "1" : "0");
  }
  // Audio changes use postMessage; they must not restart the original movie.
  adapter.searchParams.set("muted", playback.current.initialMuted ? "1" : "0");
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setError("");
    if (!validSource && !previewOnly && !reducedMotion) {
      const cause = new Error("Cette animation ne fait pas partie des ressources MSN locales.");
      setError(cause.message);
      callbacks.current.onError?.(cause);
    }
  }, [src, validSource, previewOnly, reducedMotion]);
  useEffect(() => {
    const currentFrame = frame.current;
    const expectedOrigin = adapterOrigin;
    const currentToken = playback.current.token;
    const receive = (event) => {
      if (event.source !== currentFrame?.contentWindow || event.data?.token !== currentToken || event.origin !== expectedOrigin) return;
      if (event.data.type === "msn-flash-ready") {
        currentFrame.contentWindow.postMessage({ type: "msn-flash-mute", token: currentToken, muted: audioMuted.current }, expectedOrigin === "null" ? "*" : expectedOrigin);
        callbacks.current.onReady?.(event.data.metadata);
      }
      if (event.data.type === "msn-flash-error") {
        const cause = new Error(event.data.message || "L’animation MSN n’a pas pu être lue.");
        setError(cause.message);
        callbacks.current.onError?.(cause);
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      currentFrame?.contentWindow?.postMessage({ type: "msn-flash-close", token: currentToken }, expectedOrigin === "null" ? "*" : expectedOrigin);
    };
  }, [src, previewOnly, reducedMotion]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: "msn-flash-mute", token: playback.current.token, muted }, adapterOrigin === "null" ? "*" : adapterOrigin);
  }, [muted]);
  const showPreview = previewOnly || reducedMotion || Boolean(error);
  return <div className={className} style={style} aria-label={alt}>
    {showPreview && poster ? <img src={poster} alt={alt} draggable="false" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null}
    {error ? <span role="status">{error}</span> : null}
    {!showPreview && validSource ? <iframe ref={frame} src={adapter.href} title={alt} sandbox="allow-scripts allow-same-origin" allow="autoplay" style={{ border: 0, width: "100%", height: "100%", display: "block", background: "transparent" }} /> : null}
  </div>;
}
