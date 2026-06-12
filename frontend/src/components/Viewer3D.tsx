import { useEffect, useRef, useState } from 'react';
import { EmbeddedViewer, RGBAColor } from 'online-3d-viewer';
import { LoadingManager } from 'three';

const originalSetURLModifier = LoadingManager.prototype.setURLModifier;
LoadingManager.prototype.setURLModifier = function (urlModifier?: (url: string) => string) {
  if (!urlModifier) return originalSetURLModifier.call(this, urlModifier);
  return originalSetURLModifier.call(this, (url: string) => {
    const modifiedUrl = urlModifier(url);
    if (
      typeof modifiedUrl === 'string' &&
      (modifiedUrl.startsWith('blob:http') || modifiedUrl.startsWith(window.location.origin)) &&
      /\.(png|jpg|jpeg|tga|gif|bmp|webp)$/i.test(modifiedUrl)
    ) {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }
    return modifiedUrl;
  });
};

interface Viewer3DProps {
  src: string;
  fileName: string;
  style?: React.CSSProperties;
}

export default function Viewer3D({ src, fileName, style }: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<EmbeddedViewer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !src) return;

    let cancelled = false;
    setLoading(true);

    fetch(src)
      .then(r => r.blob())
      .then(blob => {
        if (cancelled) return;

        const file = new File([blob], fileName, { type: blob.type });

        const bgColor = new RGBAColor(0x1a, 0x1a, 0x1a, 0xff);

        if (viewerRef.current) {
          viewerRef.current.Destroy();
          viewerRef.current = null;
        }

        const viewer = new EmbeddedViewer(el, {
          backgroundColor: bgColor,
          onModelLoaded: () => {
            if (!cancelled) setLoading(false);
          },
          onModelLoadFailed: () => {
            if (!cancelled) setLoading(false);
          },
        });

        viewerRef.current = viewer;

        const originalWarn = console.warn;
        console.warn = (...args: unknown[]) => {
          const msg = typeof args[0] === 'string' ? args[0] : '';
          if (msg.includes('THREE.FBXLoader')) return;
          originalWarn.apply(console, args);
        };
        setTimeout(() => { console.warn = originalWarn; }, 10000);

        viewer.LoadModelFromFileList([file]);
      });

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        viewerRef.current.Destroy();
        viewerRef.current = null;
      }
    };
  }, [src, fileName]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      {loading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1a1a1a',
          zIndex: 10,
          gap: 12,
        }}>
          <div style={{
            width: 36,
            height: 36,
            border: '3px solid #333',
            borderTop: '3px solid #4caf50',
            borderRadius: '50%',
            animation: 'spin3d 0.9s linear infinite',
          }} />
          <span style={{ color: '#888', fontSize: 12, fontFamily: 'sans-serif' }}>
            Cargando modelo 3D…
          </span>
          <style>{`@keyframes spin3d { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}