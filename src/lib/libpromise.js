/**
 * @license
 * Copyright 2023 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

addToLibrary({
  $promiseMap__deps: ['$HandleAllocator'],
  $promiseMap: 'new HandleAllocator();',

  $getPromise__deps: ['$promiseMap'],
  $getPromise: (id) => promiseMap.get(id).promise,

  $makePromise__deps: ['$promiseMap'],
  $makePromise: () => {
    var promiseInfo = {};
    promiseInfo.promise = new Promise((resolve, reject) => {
      promiseInfo.reject = reject;
      promiseInfo.resolve = resolve;
    });
    promiseInfo.id = promiseMap.allocate(promiseInfo);
#if RUNTIME_DEBUG
    dbg(`makePromise: ${promiseInfo.id}`);
#endif
    return promiseInfo;
  },

  $addPromise__deps: ['$promiseMap'],
  $addPromise: (promise) => promiseMap.allocate({promise}),

  $idsToPromises__deps: ['$getPromise'],
  $idsToPromises: (idBuf, size) => {
    var promises = [];
    for (var i = 0; i < size; i++) {
      var id = {{{ makeGetValue('idBuf', `i*${POINTER_SIZE}`, 'i32') }}};
      promises[i] = getPromise(id);
    }
    return promises;
  },

  emscripten_promise_create__deps: ['$makePromise'],
  emscripten_promise_create: () => makePromise().id,

  emscripten_promise_destroy__deps: ['$promiseMap'],
  emscripten_promise_destroy: (id) => {
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_destroy: ${id}`);
#endif
    promiseMap.free(id);
  },

  emscripten_promise_resolve__deps: ['$promiseMap',
                                     '$getPromise',
                                     'emscripten_promise_destroy'],
  emscripten_promise_resolve: (id, result, value) => {
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_resolve: ${id}`);
#endif
    var info = promiseMap.get(id);
    switch (result) {
      case {{{ cDefs.EM_PROMISE_FULFILL }}}:
        info.resolve(value);
        return;
      case {{{ cDefs.EM_PROMISE_MATCH }}}:
        info.resolve(getPromise(value));
        return;
      case {{{ cDefs.EM_PROMISE_MATCH_RELEASE }}}:
        info.resolve(getPromise(value));
        _emscripten_promise_destroy(value);
        return;
      case {{{ cDefs.EM_PROMISE_REJECT }}}:
        info.reject(value);
        return;
    }
#if ASSERTIONS
    abort(`unexpected promise callback result ${result}`);
#endif
  },

  $makePromiseCallback__deps: ['$getPromise',
                               '$POINTER_SIZE',
                               'emscripten_promise_destroy',
                               '$stackAlloc',
                               '$stackRestore',
                               '$stackSave'],
  $makePromiseCallback: (callback, userData) => {
    if (!callback) return;
    return (value) => {
#if RUNTIME_DEBUG
      dbg(`emscripten promise callback: ${value}`);
#endif
      {{{ runtimeKeepalivePop() }}};
      var stack = stackSave();
      // Allocate space for the result value and initialize it to NULL.
      var resultPtr = stackAlloc(POINTER_SIZE);
      {{{ makeSetValue('resultPtr', 0, '0', '*') }}};
      try {
        var result =
            {{{ makeDynCall('ippp', 'callback') }}}(resultPtr, userData, value);
        var resultVal = {{{ makeGetValue('resultPtr', 0, '*') }}};
      } catch (e) {
        // If the thrown value is potentially a valid pointer, use it as the
        // rejection reason. Otherwise use a null pointer as the reason. If we
        // allow arbitrary objects to be thrown here, we will get a TypeError in
        // MEMORY64 mode when they are later converted to void* rejection
        // values.
#if MEMORY64
        if (typeof e != 'bigint') {
          throw 0n;
        }
#else
        if (typeof e != 'number') {
          throw 0;
        }
#endif
        throw e;
      } finally {
        // Thrown errors will reject the promise, but at least we will restore
        // the stack first.
        stackRestore(stack);
      }
      switch (result) {
        case {{{ cDefs.EM_PROMISE_FULFILL }}}:
          return resultVal;
        case {{{ cDefs.EM_PROMISE_MATCH }}}:
          return getPromise(resultVal);
        case {{{ cDefs.EM_PROMISE_MATCH_RELEASE }}}:
          var ret = getPromise(resultVal);
          _emscripten_promise_destroy(resultVal);
          return ret;
        case {{{ cDefs.EM_PROMISE_REJECT }}}:
          throw resultVal;
      }
#if ASSERTIONS
      abort(`unexpected promise callback result ${result}`);
#endif
    };
  },

  emscripten_promise_then__deps: ['$addPromise',
                                  '$getPromise',
                                  '$makePromiseCallback'],
  emscripten_promise_then: (id, onFulfilled, onRejected, userData) => {
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_then: ${id}`);
#endif
    {{{ runtimeKeepalivePush() }}};
    var promise = getPromise(id);
    var chainedPromise = promise.then(makePromiseCallback(onFulfilled, userData),
                                      makePromiseCallback(onRejected, userData));
    var newId = addPromise(chainedPromise);
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_then: -> ${newId}`);
#endif
    return newId;
  },

  emscripten_promise_all__deps: ['$addPromise', '$idsToPromises'],
  emscripten_promise_all: (idBuf, resultBuf, size) => {
    var promises = idsToPromises(idBuf, size);
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_all: ${promises}`);
#endif
    var id = addPromise(Promise.all(promises).then((results) => {
      if (resultBuf) {
        for (var i = 0; i < size; i++) {
          var result = results[i];
          {{{ makeSetValue('resultBuf', `i*${POINTER_SIZE}`, 'result', '*') }}};
        }
      }
      return resultBuf;
    }));
#if RUNTIME_DEBUG
    dbg(`create: ${id}`);
#endif
    return id;
  },

  $setPromiseResult__internal: true,
  $setPromiseResult: (ptr, fulfill, value) => {
#if ASSERTIONS
    assert(typeof value == 'undefined' || typeof value === 'number', `native promises can only handle numeric results (${value} ${typeof value})`);
#endif
    var result = fulfill ? {{{ cDefs.EM_PROMISE_FULFILL }}} : {{{ cDefs.EM_PROMISE_REJECT }}}
    {{{ makeSetValue('ptr', C_STRUCTS.em_settled_result_t.result, 'result', 'i32') }}};
    {{{ makeSetValue('ptr', C_STRUCTS.em_settled_result_t.value, 'value', '*') }}};
  },

  emscripten_promise_all_settled__deps: ['$addPromise', '$idsToPromises', '$setPromiseResult'],
  emscripten_promise_all_settled: (idBuf, resultBuf, size) => {
    var promises = idsToPromises(idBuf, size);
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_all_settled: ${promises}`);
#endif
    var id = addPromise(Promise.allSettled(promises).then((results) => {
      if (resultBuf) {
        var offset = resultBuf;
        for (var i = 0; i < size; i++, offset += {{{ C_STRUCTS.em_settled_result_t.__size__ }}}) {
          if (results[i].status === 'fulfilled') {
            setPromiseResult(offset, true, results[i].value);
          } else {
            setPromiseResult(offset, false, results[i].reason);
          }
        }
      }
      return resultBuf;
    }));
#if RUNTIME_DEBUG
    dbg(`create: ${id}`);
#endif
    return id;
  },

  emscripten_promise_any__deps: ['$addPromise', '$idsToPromises'],
  emscripten_promise_any: (idBuf, errorBuf, size) => {
    var promises = idsToPromises(idBuf, size);
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_any: ${promises}`);
#endif
#if ASSERTIONS
    assert(typeof Promise.any != 'undefined', 'Promise.any does not exist');
#endif
    var id = addPromise(Promise.any(promises).catch((err) => {
      if (errorBuf) {
        for (var i = 0; i < size; i++) {
          {{{ makeSetValue('errorBuf', `i*${POINTER_SIZE}`, 'err.errors[i]', '*') }}};
        }
      }
      throw errorBuf;
    }));
#if RUNTIME_DEBUG
    dbg(`create: ${id}`);
#endif
    return id;
  },

  emscripten_promise_race__deps: ['$addPromise', '$idsToPromises'],
  emscripten_promise_race: (idBuf, size) => {
    var promises = idsToPromises(idBuf, size);
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_race: ${promises}`);
#endif
    var id = addPromise(Promise.race(promises));
#if RUNTIME_DEBUG
    dbg(`create: ${id}`);
#endif
    return id;
  },

  // An fd for the outcome of a Promise (the `__proxy: 'fd'` form of an
  // __async: 'auto' function, see jsifier): readable (POLLIN) once settled, with
  // POLLERR too if rejected. read() yields the fulfilled value as one
  // pointer-sized integer, or fails with EIO if rejected. The read takes
  // ownership: later reads see EOF (POLLHUP). A synchronous (non-Promise)
  // value is readable on return. The result lives on the open file
  // description, so dup'd fds share it; nothing is held after the last
  // close. A pending result holds the runtime alive like a timer.
#if WASMFS
  $fdFromPromise: (result) => {
    abort('fd result forms are not supported with WASMFS');
  },
#else
  $fdFromPromise__deps: ['$FS', '$fdResultSettle', '$fdResultRelease'],
  $fdFromPromise: (result) => {
    var stream = FS.createStream({
      node: new FS.FSNode(0, '', 0, 0),
      flags: {{{ cDefs.O_RDONLY }}},
      stream_ops: {
        poll: (stream) => {
          var r = stream.shared.result;
          if (!r) return 0;
          if (r.consumed) return {{{ cDefs.POLLHUP }}};
          return {{{ cDefs.POLLIN | cDefs.POLLRDNORM }}} | (r.rejected ? {{{ cDefs.POLLERR }}} : 0);
        },
        read: (stream, buffer, offset, length) => {
          var r = stream.shared.result;
          if (!r) throw new FS.ErrnoError({{{ cDefs.EAGAIN }}});
          if (r.consumed) return 0;
          if (r.rejected) throw new FS.ErrnoError({{{ cDefs.EIO }}});
          if (length < {{{ POINTER_SIZE }}}) throw new FS.ErrnoError({{{ cDefs.EINVAL }}});
#if ASSERTIONS
          assert(buffer.buffer === HEAP8.buffer, 'result fds are read into wasm memory');
#endif
          {{{ makeSetValue('offset', 0, 'r.value', '*') }}};
          r.consumed = true;
          return {{{ POINTER_SIZE }}};
        },
        dup: (stream) => stream.shared.refcount++,
        close: (stream) => {
          if (--stream.shared.refcount) return;
          stream.shared.closed = true;
          if (!stream.shared.result) fdResultRelease();
        },
      },
    });
    var shared = stream.shared;
    shared.refcount = 1;
    if (result instanceof Promise) {
      {{{ runtimeKeepalivePush() }}}
      result.then((value) => fdResultSettle(stream, {value}),
                  () => fdResultSettle(stream, {rejected: true}));
    } else {
      shared.result = {value: result};
    }
    return stream.fd;
  },
  $fdResultRelease__internal: true,
  $fdResultRelease: () => {
    {{{ runtimeKeepalivePop() }}}
  },
  $fdResultSettle__internal: true,
  $fdResultSettle__deps: ['$fdResultRelease'],
  $fdResultSettle: (stream, result) => {
    var shared = stream.shared;
    if (shared.closed) return;
    fdResultRelease();
    shared.result = result;
    stream.node.notifyListeners({{{ cDefs.POLLIN | cDefs.POLLRDNORM }}} | (result.rejected ? {{{ cDefs.POLLERR }}} : 0));
  },
#endif

#if ASYNCIFY
  emscripten_promise_await__async: 'auto',
  emscripten_promise_await__deps: ['$getPromise', '$setPromiseResult'],
  emscripten_promise_await: (returnValuePtr, id) => {
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_await: ${id}`);
#endif
    return getPromise(id).then(
      value => setPromiseResult(returnValuePtr, true, value),
      error => setPromiseResult(returnValuePtr, false, error)
    );
  },

  emscripten_promise_await_unchecked__async: 'auto',
  emscripten_promise_await_unchecked__deps: ['$getPromise'],
  emscripten_promise_await_unchecked: (id) => {
#if RUNTIME_DEBUG
    dbg(`emscripten_promise_await_unchecked: ${id}`);
#endif
    return getPromise(id);
  },
#else
  emscripten_promise_await: (returnValuePtr, id) => {
    abort('emscripten_promise_await is only available with ASYNCIFY');
  },
  emscripten_promise_await_unchecked: (id) => {
    abort('emscripten_promise_await_unchecked is only available with ASYNCIFY');
    return 0;
  },
#endif
});
