declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(viewport: HTMLElement, channel: import('./vnc-channel').VncChannel);
    scaleViewport: boolean;
    viewOnly: boolean;
    toBlob(callback: BlobCallback, type: string): void;
    focus(): void;
    disconnect(): void;
    clipboardPasteFrom(text: string): void;
    sendKey(keysym: number, code: string, down: boolean): void;
    sendCtrlAltDel(): void;
    approveServer(): void;
    sendCredentials(credentials: Record<string, string>): void;
  }
}
