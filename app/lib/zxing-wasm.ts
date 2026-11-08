// Serve ZXing's WebAssembly decoder from our own origin. By default
// zxing-wasm downloads it from a CDN at runtime — an outside dependency (and
// an IP leak) every time someone scans an invoice QR. Vite emits the file into
// our bundle and gives us its URL.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

export const zxingOverrides = {
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
}
