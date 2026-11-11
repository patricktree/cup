# Third-party notices

`src/time-stretcher.wasm` contains the Sonic library, Copyright 2010 Bill Cox, distributed under the Apache License, Version 2.0.

- Source: <https://github.com/waywardgeek/sonic/archive/b93885dcb70aae50c6f76b0fe4e0868f029a077e.tar.gz> (commit `b93885dcb70aae50c6f76b0fe4e0868f029a077e`)
- SHA-256: `b76d832649306b53e716c271014c0b8f89f6bcefc43e5068a2eca3cf1946324c`
- Built artifact SHA-256: `c923e7b662bf58c30b9a6eb3cdeabf3fe849ccabfb0a91148665673e2bca2353`
- License: <https://www.apache.org/licenses/LICENSE-2.0> (the source's [`LICENSE`](https://github.com/waywardgeek/sonic/blob/b93885dcb70aae50c6f76b0fe4e0868f029a077e/LICENSE))

Run `pnpm run build:time-stretcher` to rebuild the WebAssembly module from that source with the toolchain pinned in the build script. The build needs Docker; it verifies the source archive's checksum before use, compiles in a container without network access, and replaces the committed module only when the result matches the built artifact checksum above.
