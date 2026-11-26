import RFB from '@novnc/novnc';
export default class ClipboardRFB extends RFB {
  clipboardPasteFrom(text: string, usable?: () => boolean): Promise<void> | void;
  clipboardPasteDib(bytes: Uint8Array, usable?: () => boolean): Promise<void>;
}
