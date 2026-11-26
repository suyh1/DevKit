declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(viewport: HTMLElement, channel: import('./vnc-channel').VncChannel);
    scaleViewport: boolean;
    viewOnly: boolean;
    focus(): void;
    disconnect(): void;
    sendCtrlAltDel(): void;
    approveServer(): void;
    sendCredentials(credentials: Record<string, string>): void;
  }
}
