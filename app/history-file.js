/* 把路线历史落到 local/history.local.js
 *
 * 历史的正式归宿是那个文件（本机私有、不进 git）；浏览器草稿里那份只是会话内的临时副本，
 * 离开页面时会被摘掉（见 app/main.js 的 pagehide）。往文件里写有两条路：
 *
 *   手动导出  —— 任何浏览器都能用。点「导出 history.local.js」下载，自己覆盖到 local/ 下。
 *   绑定目录  —— Chrome/Edge 的 File System Access API。授权一次 local/ 目录，
 *                之后每次历史变化都自动写文件，不用再手动导出。
 *
 * 目录句柄存在 IndexedDB 里，所以刷新/重开页面还能续用；但**权限查询不弹窗**
 * （弹窗必须由用户手势触发），权限不在时只在界面上提示"需要重新绑定"。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  else { root.FX = root.FX || {}; root.FX.historyFile = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var FILE = 'history.local.js';
  var DB = 'fuxiao.history', STORE = 'handles', HKEY = 'localDir';

  var st = {
    supported: typeof root.showDirectoryPicker === 'function' && !!root.indexedDB,
    bound: false, dirName: '', needsPermission: false, error: '', dirty: false
  };

  /* ---------- IndexedDB：存目录句柄 ---------- */
  function openDB() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) { rej(new Error('no indexedDB')); return; }
      var r = root.indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbOp(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, mode);
        var req = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { res(req && req.result); };
        tx.onerror = function () { rej(tx.error); };
        tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function getHandle() {
    return idbOp('readonly', function (s) { return s.get(HKEY); }).catch(function () { return null; });
  }
  function putHandle(h) { return idbOp('readwrite', function (s) { return s.put(h, HKEY); }); }
  function delHandle() { return idbOp('readwrite', function (s) { return s.delete(HKEY); }); }

  /* ---------- 写文件 ---------- */
  function historyJson() {
    return (root.FX && root.FX.store) ? (root.FX.store.state.historyByMap || {}) : {};
  }

  function writeTo(dirHandle) {
    var text = root.FX.store.historyFileText(historyJson());
    return dirHandle.getFileHandle(FILE, { create: true })
      .then(function (fh) { return fh.createWritable(); })
      .then(function (w) {
        return w.write(text).then(function () { return w.close(); });
      });
  }

  function permission(h, interactive) {
    if (!h || !h.queryPermission) return Promise.resolve(false);
    return h.queryPermission({ mode: 'readwrite' }).then(function (p) {
      if (p === 'granted') return true;
      if (!interactive || !h.requestPermission) return false;
      return h.requestPermission({ mode: 'readwrite' }).then(function (p2) { return p2 === 'granted'; });
    });
  }

  /** 绑定 local/ 目录。**必须在用户手势里调用**（会弹原生目录选择框） */
  function bind() {
    if (!st.supported) return Promise.resolve(false);
    return root.showDirectoryPicker({ id: 'fx-local', mode: 'readwrite' })
      .then(function (h) {
        return putHandle(h).then(function () { return h; });
      })
      .then(function (h) {
        st.bound = true; st.dirName = h.name || '';
        return permission(h, true).then(function (ok) {
          st.needsPermission = !ok;
          st.error = ok ? '' : '没有拿到这个目录的写入权限';
          if (!ok) return false;
          return writeTo(h).then(function () { markSaved(); return true; });
        });
      })
      .catch(function (e) {
        st.error = String((e && (e.name || e.message)) || e);
        return false;
      });
  }

  function unbind() {
    return delHandle().then(function () {
      st.bound = false; st.dirName = ''; st.needsPermission = false; st.error = '';
    }).catch(function () { st.bound = false; });
  }

  /** 启动时恢复上次绑定的目录（**不弹窗**，只查权限） */
  function restore() {
    if (!st.supported) return Promise.resolve(false);
    return getHandle().then(function (h) {
      if (!h) return false;
      st.bound = true; st.dirName = h.name || '';
      return permission(h, false).then(function (ok) {
        st.needsPermission = !ok;
        return ok;
      });
    }).catch(function () { return false; });
  }

  /** 自动写：不是用户手势，所以不弹权限窗；没权限就跳过并记下来让界面提示 */
  function autoSave() {
    if (!st.bound) return Promise.resolve(false);
    return getHandle().then(function (h) {
      return permission(h, false).then(function (ok) {
        if (!ok) { st.needsPermission = true; return false; }
        st.needsPermission = false;
        return writeTo(h).then(function () { markSaved(); return true; });
      });
    }).catch(function (e) {
      st.error = String((e && (e.name || e.message)) || e);
      return false;
    });
  }

  function markSaved() { st.dirty = false; }
  function markDirty() { st.dirty = true; }

  function status() {
    return { supported: st.supported, bound: st.bound, dirName: st.dirName,
             needsPermission: st.needsPermission, error: st.error, dirty: st.dirty };
  }

  return {
    FILE: FILE, supported: function () { return st.supported; },
    bind: bind, unbind: unbind, restore: restore, autoSave: autoSave,
    markDirty: markDirty, markSaved: markSaved, status: status
  };
});
