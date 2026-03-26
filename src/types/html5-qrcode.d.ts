declare module 'html5-qrcode' {
  export class Html5Qrcode {
    constructor(elementId: string);
    start(
      cameraIdOrConfig: string | { facingMode?: string },
      configuration?: { fps?: number; qrbox?: { width?: number; height?: number } },
      qrCodeSuccessCallback?: (decodedText: string) => void,
      qrCodeErrorCallback?: (error: string) => void
    ): Promise<void>;
    stop(): Promise<void>;
    isScanning?: boolean;
    clear?: () => Promise<void>;
  }
}
