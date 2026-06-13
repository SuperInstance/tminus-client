/**
 * Browser-compatible WebSocket shim for the tminus-client SDK.
 * The SDK requires `ws` — in the browser we just use the native WebSocket.
 */
export default typeof WebSocket !== 'undefined' ? WebSocket : null;
