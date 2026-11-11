#include <emscripten.h>
#include <stdlib.h>
#include <sonic.h>

// JavaScript copies PCM in and out through one fixed buffer per stretcher.
#define PCM_SAMPLE_CAPACITY 4608
#define STRETCHER_OK 0
#define STRETCHER_ERROR_INVALID_ARGUMENT -1
#define STRETCHER_ERROR_FAILED -2

typedef struct Stretcher {
  short *pcm;
  sonicStream stream;
  struct Stretcher *next;
} Stretcher;

// JavaScript supplies raw numeric handles, so validate membership before dereferencing one.
static Stretcher *live_stretchers;

static Stretcher *find_live_stretcher(const Stretcher *candidate) {
  Stretcher *stretcher = live_stretchers;

  while (stretcher) {
    if (stretcher == candidate) {
      return stretcher;
    }
    stretcher = stretcher->next;
  }

  return NULL;
}

EMSCRIPTEN_KEEPALIVE
Stretcher *stretcher_create(int sample_rate, float speed) {
  // Sonic clamps values outside its supported ranges; reject them instead of stretching wrongly.
  if (sample_rate < SONIC_MIN_SAMPLE_RATE || sample_rate > SONIC_MAX_SAMPLE_RATE) {
    return NULL;
  }
  if (!(speed >= SONIC_MIN_SPEED && speed <= SONIC_MAX_SPEED)) {
    return NULL;
  }

  Stretcher *stretcher = calloc(1, sizeof(Stretcher));
  if (!stretcher) {
    return NULL;
  }

  stretcher->pcm = malloc(PCM_SAMPLE_CAPACITY * sizeof(short));
  stretcher->stream = sonicCreateStream(sample_rate, 1);
  if (!stretcher->pcm || !stretcher->stream) {
    goto cleanup;
  }

  sonicSetSpeed(stretcher->stream, speed);
  // Disables Sonic's speed-up heuristics, as the `sonic -q` CLI flag does.
  sonicSetQuality(stretcher->stream, 1);

  stretcher->next = live_stretchers;
  live_stretchers = stretcher;

  return stretcher;

cleanup:
  if (stretcher->stream) {
    sonicDestroyStream(stretcher->stream);
  }
  free(stretcher->pcm);
  free(stretcher);
  return NULL;
}

EMSCRIPTEN_KEEPALIVE
short *stretcher_get_pcm(Stretcher *stretcher) {
  Stretcher *live_stretcher = find_live_stretcher(stretcher);
  return live_stretcher ? live_stretcher->pcm : NULL;
}

EMSCRIPTEN_KEEPALIVE
int stretcher_write(Stretcher *stretcher, int sample_count) {
  Stretcher *live_stretcher = find_live_stretcher(stretcher);

  if (!live_stretcher || sample_count < 0 || sample_count > PCM_SAMPLE_CAPACITY) {
    return STRETCHER_ERROR_INVALID_ARGUMENT;
  }

  if (!sonicWriteShortToStream(live_stretcher->stream, live_stretcher->pcm, sample_count)) {
    return STRETCHER_ERROR_FAILED;
  }

  return STRETCHER_OK;
}

EMSCRIPTEN_KEEPALIVE
int stretcher_flush(Stretcher *stretcher) {
  Stretcher *live_stretcher = find_live_stretcher(stretcher);

  if (!live_stretcher) {
    return STRETCHER_ERROR_INVALID_ARGUMENT;
  }

  if (!sonicFlushStream(live_stretcher->stream)) {
    return STRETCHER_ERROR_FAILED;
  }

  return STRETCHER_OK;
}

// Returns the number of stretched samples copied into the PCM buffer; 0 once none are left.
EMSCRIPTEN_KEEPALIVE
int stretcher_read(Stretcher *stretcher) {
  Stretcher *live_stretcher = find_live_stretcher(stretcher);

  if (!live_stretcher) {
    return STRETCHER_ERROR_INVALID_ARGUMENT;
  }

  return sonicReadShortFromStream(live_stretcher->stream, live_stretcher->pcm, PCM_SAMPLE_CAPACITY);
}

EMSCRIPTEN_KEEPALIVE
void stretcher_free(Stretcher *stretcher) {
  Stretcher **link = &live_stretchers;

  while (*link && *link != stretcher) {
    link = &(*link)->next;
  }

  if (!*link) {
    return;
  }

  Stretcher *live_stretcher = *link;
  *link = live_stretcher->next;

  sonicDestroyStream(live_stretcher->stream);
  free(live_stretcher->pcm);
  free(live_stretcher);
}
