const target = process.env.GAME_WS_URL || 'ws://localhost:8080/lan';
const expectedStateBytes = 283;
const timeoutMs = 5000;

const socket = new WebSocket(target);
socket.binaryType = 'arraybuffer';

let welcomed = false;
let receivedState = false;

const timeout = setTimeout(() => {
  console.error(`Smoke-Test nach ${timeoutMs} ms abgebrochen: ${target}`);
  socket.close();
  process.exitCode = 1;
}, timeoutMs);

function succeedWhenComplete() {
  if (!welcomed || !receivedState) return;
  clearTimeout(timeout);
  console.log(`OK: welcome + ${expectedStateBytes}-Byte-Snapshot von ${target}`);
  socket.close(1000, 'smoke test complete');
}

socket.addEventListener('message', (event) => {
  if (typeof event.data === 'string') {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      welcomed = true;
      const input = new ArrayBuffer(7);
      const view = new DataView(input);
      view.setUint8(0, 1);
      view.setUint32(1, 1, true);
      view.setUint8(5, 1);
      socket.send(input);
      succeedWhenComplete();
    }
    return;
  }

  const byteLength = event.data?.byteLength;
  if (byteLength !== expectedStateBytes) {
    clearTimeout(timeout);
    console.error(`Unerwartete Snapshot-Groesse: ${byteLength}`);
    socket.close();
    process.exitCode = 1;
    return;
  }
  const view = new DataView(event.data);
  if (view.getUint8(0) !== 2) {
    clearTimeout(timeout);
    console.error(`Unerwarteter Nachrichtentyp: ${view.getUint8(0)}`);
    socket.close();
    process.exitCode = 1;
    return;
  }
  receivedState = true;
  succeedWhenComplete();
});

socket.addEventListener('error', () => {
  clearTimeout(timeout);
  console.error(`WebSocket konnte nicht geoeffnet werden: ${target}`);
  process.exitCode = 1;
});

socket.addEventListener('close', () => clearTimeout(timeout));
