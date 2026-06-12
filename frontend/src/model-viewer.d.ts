declare namespace JSX {
  interface IntrinsicElements {
    'model-viewer': {
      src?: string;
      alt?: string;
      'camera-controls'?: boolean;
      'auto-rotate'?: boolean;
      style?: React.CSSProperties;
      [key: string]: any;
    };
  }
}