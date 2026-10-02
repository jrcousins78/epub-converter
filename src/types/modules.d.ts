declare module 'mammoth';
declare module 'heic2any' {
  export default function heic2any(opts: { blob: Blob; toType?: string; quality?: number }): Promise<Blob | Blob[]>;
}
