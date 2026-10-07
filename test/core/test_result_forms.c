/*
 * Copyright 2026 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Result forms of one asynchronous library function, defined in
 * test_result_forms.js: `answer_promise()` (an alias with `__proxy:
 * 'promise'`) yields an em_promise_t fulfilled with the value; `answer()` the
 * value itself where the stack can wait (ASYNCIFY/JSPI, or a pthread), else
 * what the body returns when told it cannot.
 */

#include <assert.h>
#include <emscripten.h>
#include <emscripten/promise.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

intptr_t answer(int ms, intptr_t value);
em_promise_t answer_promise(int ms, intptr_t value);

int stage;

em_promise_result_t fail(void** result, void* data, void* value) {
  assert(0 && "promise rejected");
}

em_promise_result_t on_rejected(void** result, void* data, void* value) {
  assert(stage++ == 2);
  assert(value == NULL);
  printf("done\n");
#ifdef __EMSCRIPTEN_PTHREADS__
  exit(0);
#endif
  return EM_PROMISE_FULFILL;
}

em_promise_result_t on_fulfilled(void** result, void* data, void* value) {
  assert(stage++ == 1);
  assert((intptr_t)value == 42);
  // A rejected promise.
  em_promise_t p = answer_promise(5, 0);
  em_promise_t next = emscripten_promise_then(p, fail, on_rejected, NULL);
  emscripten_promise_destroy(p);
  emscripten_promise_destroy(next);
  return EM_PROMISE_FULFILL;
}

em_promise_result_t on_sync(void** result, void* data, void* value) {
  assert(stage++ == 0);
  assert((intptr_t)value == 7);
  em_promise_t p = answer_promise(5, 42);
  em_promise_t next = emscripten_promise_then(p, on_fulfilled, fail, NULL);
  emscripten_promise_destroy(p);
  emscripten_promise_destroy(next);
  return EM_PROMISE_FULFILL;
}

int main() {
  // The synchronous form.
  assert(answer(0, 7) == 7);
#if defined(__EMSCRIPTEN_PTHREADS__) || defined(ASYNC)
  assert(answer(5, 42) == 42);
#else
  // Where the stack cannot wait, the body is told so.
  assert(answer(5, 42) == -1);
#endif

  // A synchronous completion is a fulfilled promise.
  em_promise_t p = answer_promise(0, 7);
  em_promise_t next = emscripten_promise_then(p, on_sync, fail, NULL);
  emscripten_promise_destroy(p);
  emscripten_promise_destroy(next);
  return 0;
}
