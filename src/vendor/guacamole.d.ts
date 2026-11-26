type Status = { code: number };
type InstructionHandler = (opcode: string, parameters: string[]) => void;
type MouseState = { x: number; y: number; left: boolean; middle: boolean; right: boolean; up: boolean; down: boolean };
type Pointer = { onEach(events: string[], handler: (event: { state: MouseState }) => void): void };
type Tunnel = {
  connect(): void;
  disconnect(): void;
  sendMessage(...elements: (string | number)[]): void;
  setState(state: number): void;
  oninstruction: InstructionHandler | null;
};
type InputStream = {
  sendAck(message: string, code: number): void;
  onblob: ((data: string) => void) | null;
  onend: (() => void) | null;
};
type Client = {
  connect(): void;
  disconnect(): void;
  getDisplay(): {
    flatten(): HTMLCanvasElement;
    getElement(): HTMLElement;
    getWidth(): number;
    getHeight(): number;
    scale(scale: number): void;
    onresize: (() => void) | null;
  };
  onfilesystem: ((filesystem: unknown, name: string) => void) | null;
  onfile: ((stream: InputStream, mime: string, name: string) => void) | null;
  onclipboard: ((stream: InputStream, mime: string) => void) | null;
  sendSize(width: number, height: number): void;
  sendKeyEvent(pressed: number, keysym: number): void;
  sendMouseState(state: MouseState, applyDisplayScale: boolean): void;
  onstatechange: ((state: number) => void) | null;
  onerror: ((status: Status) => void) | null;
};
declare const Guacamole: {
  Tunnel: { new(): Tunnel; State: { CONNECTING: number; OPEN: number; CLOSED: number } };
  Parser: new() => { receive(data: string): void; oninstruction: InstructionHandler | null };
  Client: { new(tunnel: Tunnel): Client; State: { CONNECTED: number } };
  Keyboard: new(element: HTMLElement) => {
    onkeydown: ((keysym: number) => boolean) | null;
    onkeyup: ((keysym: number) => void) | null;
    reset(): void;
  };
  Mouse: { new(element: HTMLElement): Pointer; Touchscreen: new(element: HTMLElement) => Pointer };
};
export default Guacamole;
