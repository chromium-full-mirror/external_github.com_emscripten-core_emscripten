/*
 * Copyright 2026 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * The fd result form (an alias with `__proxy: 'fd'`) of the asynchronous
 * library function in test_result_forms.js: `answer_fd()` yields an fd
 * readable once settled, whose read() takes the value.
 */

#include <assert.h>
#include <emscripten.h>
#include <emscripten/eventloop.h>
#include <errno.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int answer_fd(int ms, intptr_t value);

int readable(int fd, short expect) {
  struct pollfd p = { .fd = fd, .events = POLLIN };
  int n = poll(&p, 1, 0);
  assert(n == 0 || (n == 1 && p.revents == expect));
  return n;
}

intptr_t take(int fd) {
  intptr_t v;
  assert(read(fd, &v, sizeof v) == sizeof v);
  assert(close(fd) == 0);
  return v;
}

void check_rejected(void* arg) {
  int fd = (int)(intptr_t)arg;
  if (!readable(fd, POLLIN | POLLERR)) {
    emscripten_set_timeout(check_rejected, 1, arg);
    return;
  }
  intptr_t v;
  assert(read(fd, &v, sizeof v) == -1 && errno == EIO);
  assert(close(fd) == 0);
  printf("done\n");
#ifdef __EMSCRIPTEN_PTHREADS__
  exit(0);
#endif
}

void check_pending(void* arg) {
  int fd = (int)(intptr_t)arg;
  if (!readable(fd, POLLIN)) {
    emscripten_set_timeout(check_pending, 1, arg);
    return;
  }
  assert(take(fd) == 42);

  // Rejection: readable with POLLERR, read() fails with EIO.
  fd = answer_fd(5, 0);
  emscripten_set_timeout(check_rejected, 1, (void*)(intptr_t)fd);
}

int main() {
  // Synchronous completion is readable on return. The read takes the result;
  // after it the fd is at EOF.
  int fd = answer_fd(0, 7);
  assert(readable(fd, POLLIN));
  intptr_t v;
  assert(read(fd, &v, sizeof v) == sizeof v && v == 7);
  assert(readable(fd, POLLHUP));
  assert(read(fd, &v, sizeof v) == 0);
  assert(close(fd) == 0);

  // A dup shares the result.
  fd = answer_fd(0, 7);
  int d = dup(fd);
  assert(close(fd) == 0);
  assert(take(d) == 7);

  // Pending until the timer fires; read() before then is EAGAIN. (On a
  // pthread each proxied call gives the main thread's loop a turn, so the
  // timer may already have fired.)
  fd = answer_fd(5, 42);
#ifndef __EMSCRIPTEN_PTHREADS__
  assert(!readable(fd, POLLIN));
  assert(read(fd, &v, sizeof v) == -1 && errno == EAGAIN);
#endif

  // Closing a pending fd drops its result.
  assert(close(answer_fd(5, 1)) == 0);

  emscripten_set_timeout(check_pending, 1, (void*)(intptr_t)fd);
  return 0;
}
