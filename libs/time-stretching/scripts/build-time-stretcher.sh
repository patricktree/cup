#!/bin/sh

# Abort before publishing an artifact when a command fails or a variable is unset.
set -eu

# Pin every external input by content, not a mutable branch, release or container tag.
# Pinning the output separately also detects toolchain or build-environment drift.
SONIC_COMMIT="b93885dcb70aae50c6f76b0fe4e0868f029a077e"
SONIC_ARCHIVE_SHA256="b76d832649306b53e716c271014c0b8f89f6bcefc43e5068a2eca3cf1946324c"
EMSCRIPTEN_IMAGE="emscripten/emsdk@sha256:8714ed3a9fb585e662c931259a996bac36a57a8dd34b81e8277436fd77364475"
TIME_STRETCHER_SHA256="c923e7b662bf58c30b9a6eb3cdeabf3fe849ccabfb0a91148665673e2bca2353"

script_directory="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
package_directory="$(dirname -- "${script_directory}")"
# Keep downloaded and generated files outside the repository until every check passes.
build_directory="$(mktemp -d "${TMPDIR:-/tmp}/cup-time-stretching-sonic.XXXXXX")"

# The recursive cleanup target is always the exact directory returned by mktemp.
cleanup() {
  rm -rf -- "${build_directory}"
}

trap cleanup EXIT HUP INT TERM

archive_path="${build_directory}/sonic-${SONIC_COMMIT}.tar.gz"
source_directory="${build_directory}/sonic"

mkdir -p "${source_directory}"
# Download on the host so the build container can run without network access. Verify the
# archive before tar parses it; extraction remains confined to the unique temporary directory.
curl --fail --location --retry 3 \
  "https://github.com/waywardgeek/sonic/archive/${SONIC_COMMIT}.tar.gz" \
  --output "${archive_path}"

printf '%s  %s\n' "${SONIC_ARCHIVE_SHA256}" "${archive_path}" | shasum -a 256 --check
tar -xzf "${archive_path}" --strip-components=1 -C "${source_directory}"

# Container security model:
# - --rm removes the container and its anonymous cache volume after the build.
# - --platform fixes architecture-dependent output for reproducibility.
# - --network none prevents downloaded build code from contacting external services.
# - --cap-drop ALL and no-new-privileges remove privilege-escalation paths.
# - --read-only prevents changes to the pinned image filesystem.
# - The private /tmp cannot expose host devices or honor setuid bits.
# - The numeric host user owns the build directory, avoiding root inside the container.
# - The anonymous Emscripten cache permits required LTO asset generation without a host mount.
# - Native bridge sources are read-only; only the temporary build directory is writable.
# No Docker socket, host credentials, host environment variables, or repository root are passed.
docker run --rm --platform linux/amd64 \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,nosuid,nodev \
  --user "$(id -u):$(id -g)" \
  --volume /emsdk/upstream/emscripten/cache \
  --volume "${package_directory}/native:/source:ro" \
  --volume "${build_directory}:/work" \
  --workdir /work \
  "${EMSCRIPTEN_IMAGE}" \
  sh -c '
    set -eu

    # Compile only the Sonic library and the narrow bridge: no command-line frontend, no WAV
    # file support, no spectrogram. Emit an initialization-only standalone module with no
    # command entry point, no threads and no filesystem, then optimize and strip it to minimize
    # unused runtime surface. Tests separately pin its import list.
    emcc /source/sonic-bridge.c sonic/sonic.c \
      -I sonic \
      -DNDEBUG \
      --no-entry \
      -s MALLOC=emmalloc \
      -s ALLOW_MEMORY_GROWTH \
      -s STANDALONE_WASM \
      -s NO_SUPPORT_ERRNO \
      -s FILESYSTEM=0 \
      -Oz \
      -flto \
      -Wl,--strip-all \
      -o time-stretcher.wasm
  '

# This is the only repository write: refuse it unless the result is byte-for-byte reproducible.
generated_time_stretcher_sha256="$(shasum -a 256 "${build_directory}/time-stretcher.wasm" | cut -d ' ' -f 1)"
if [ "${generated_time_stretcher_sha256}" != "${TIME_STRETCHER_SHA256}" ]; then
  printf 'Generated time stretcher SHA-256 does not match: expected %s, received %s\n' \
    "${TIME_STRETCHER_SHA256}" "${generated_time_stretcher_sha256}" >&2
  exit 1
fi
cp "${build_directory}/time-stretcher.wasm" "${package_directory}/src/time-stretcher.wasm"
