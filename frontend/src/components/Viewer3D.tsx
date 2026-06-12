import { useEffect, useRef } from 'react';
import { EmbeddedViewer, RGBAColor } from 'online-3d-viewer';

interface Viewer3DProps {
  src: string;
  fileName: string;
  style?: React.CSSProperties;
}

function base64DataUriToUint8Array(dataUri: string): { mime: string; bytes: Uint8Array } {
  const parts = dataUri.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
  const base64 = parts[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { mime, bytes };
}

function dataUriToFile(dataUri: string, fileName: string): File {
  const { mime, bytes } = base64DataUriToUint8Array(dataUri);
  const buf = bytes.buffer.slice(0) as ArrayBuffer;
  return new File([buf], fileName, { type: mime });
}

export default function Viewer3D({ src, fileName, style }: Viewer3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<EmbeddedViewer | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !src) return;

    const file = dataUriToFile(src, fileName);

    const bgColor = new RGBAColor(0x1a, 0x1a, 0x1a, 0xff);

    const viewer = new EmbeddedViewer(el, {
      backgroundColor: bgColor,
      onModelLoaded: () => {},
      onModelLoadFailed: () => {},
    });

    viewerRef.current = viewer;
    viewer.LoadModelFromFileList([file]);

    return () => {
      if (viewerRef.current) {
        viewerRef.current.Destroy();
        viewerRef.current = null;
      }
    };
  }, [src, fileName]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        ...style,
      }}
    />
  );
}