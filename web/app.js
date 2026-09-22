/**
 * OnlineNote 前端逻辑（v1.5，零构建）
 * - Typora 式所见即所得：直接在预览（渲染效果）中书写，输入即实时渲染
 *   （输入 # 变标题、**文字** 变粗体、- 变列表……）
 * - 每次输入后整文档重渲染，并通过源码⇄DOM 位置映射精确恢复光标
 * - 中文输入法（IME）组合期间不重渲染，组合结束再渲染
 * - Ctrl+/ 切换源码模式（大文本框）；Ctrl+Z 撤销；Ctrl+S 保存
 * - SVG 图标目录树、夜间主题
 */
(function () {
  'use strict';

  var state = {
    tree: null,
    currentPath: null,
    currentName: '',
    selectedDir: '',
    dirty: false,
    username: '',
    mode: 'preview',        // 'source' | 'preview'
    lines: [],              // 文档源行（编辑模型）
    blocks: [],             // 当前文档块（docBlocks() 解析）
    maps: [],               // 每块的 srcAtDom / domAtSrc 映射
    undoStack: [],          // [{text, caret:{i,off}}]
    composing: false,
    compStart: null,        // 输入法组合开始时的光标位置
    compLines: null         // 输入法组合开始时的源行快照
  };

  function $(id) { return document.getElementById(id); }

  /* ---------- SVG 图标 ---------- */
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  var ICONS = {
    folder: svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
    folderOpen: svg('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'),
    file: svg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><text x="8.2" y="16.2" font-size="6.5" font-weight="700" fill="currentColor" stroke="none" font-family="Arial, sans-serif">M&#8595;</text>'),
    moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
    code: svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'),
    eye: svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>')
  };

  /* ---------- API 封装 ---------- */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch('/api' + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) {
          showAuth();
          throw new Error(data.error || '未登录');
        }
        if (!res.ok) {
          throw new Error(data.error || ('请求失败 (' + res.status + ')'));
        }
        return data;
      });
    });
  }

  /* ---------- 视图切换 ---------- */
  function showAuth() {
    $('auth-view').classList.remove('hidden');
    $('main-view').classList.add('hidden');
    hideCtxMenu();
  }

  function showMain() {
    $('auth-view').classList.add('hidden');
    $('main-view').classList.remove('hidden');
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }

  function authError(msg) {
    var e = $('auth-error');
    e.textContent = msg;
    e.classList.remove('hidden');
  }

  /* ---------- 主题 ---------- */
  function updateThemeBtn() {
    var dark = document.body.classList.contains('dark');
    $('theme-btn').innerHTML = dark ? ICONS.sun : ICONS.moon;
  }

  function toggleTheme() {
    document.body.classList.toggle('dark');
    var dark = document.body.classList.contains('dark');
    try { localStorage.setItem('onlinenote-theme', dark ? 'dark' : 'light'); } catch (e) {}
    updateThemeBtn();
  }

  /* ---------- 模式 ---------- */
  function updateModeBtn() {
    var btn = $('mode-btn');
    btn.innerHTML = state.mode === 'preview'
      ? ICONS.code + '<span>源码</span>'
      : ICONS.eye + '<span>预览</span>';
  }

  function updateModeHint() {
    $('mode-hint').textContent = state.mode === 'preview'
      ? '预览模式 · 点击正文直接编写，输入即渲染（Ctrl+/ 切源码）'
      : '源码模式 · Ctrl+/ 查看预览';
  }

  function setMode(m) {
    if (m === state.mode) return;
    if (m === 'source') {
      // 源码是唯一事实来源：直接使用 state.lines，不做 DOM 回读
      $('src-editor').value = state.lines.join('\n');
      $('src-editor').classList.remove('hidden');
      $('wysiwyg').classList.add('hidden');
    } else {
      state.lines = $('src-editor').value ? $('src-editor').value.split('\n') : [];
      renderDocument();
      $('wysiwyg').classList.remove('hidden');
      $('src-editor').classList.add('hidden');
    }
    state.mode = m;
    try { localStorage.setItem('onlinenote-mode', m); } catch (e) {}
    updateModeBtn();
    updateModeHint();
  }

  /* ================= 所见即所得编辑器核心 ================= */

  function walkNodes(root, fn) {
    var stack = [root];
    while (stack.length) {
      var n = stack.shift();
      if (fn(n)) return true;
      if (n.childNodes && n.childNodes.length) {
        stack = Array.prototype.slice.call(n.childNodes).concat(stack);
      }
    }
    return false;
  }

  // 渲染文档（源码 → 可编辑的富文本块）
  function renderDocument() {
    var box = $('wysiwyg');
    state.blocks = docBlocks();
    if (state.blocks.length === 0) {
      state.blocks = [{ kind: 'para', start: 0, end: 0 }];
    }
    state.maps = [];
    box.innerHTML = '';
    state.blocks.forEach(function (b, i) {
      var srcLines = state.lines.slice(b.start, b.end);
      var r = b.kind === 'hr'
        ? MD.renderBlockMapped(srcLines, 'hr', '')
        : MD.renderBlockMapped(srcLines, b.kind, b.lang || '');
      state.maps.push({ srcAtDom: r.srcAtDom, domAtSrc: r.domAtSrc, srcLen: srcLines.join('\n').length });
      var holder = document.createElement('div');
      holder.innerHTML = r.html;
      var el = holder.firstChild || document.createElement('p');
      el.className = 'md-blk';
      el.dataset.i = i;
      if (b.kind !== 'hr') el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
      if (b.kind === 'para' && srcLines.join('').trim() === '') {
        el.innerHTML = '<br>'; // 空段落占位，保证可点击输入
      }
      box.appendChild(el);
    });
  }

  // 序列化（DOM → 源行）
  function serializeDocument() {
    var box = $('wysiwyg');
    var out = [];
    for (var k = 0; k < state.blocks.length; k++) {
      var el = box.children[k];
      if (!el) break;
      var bl = serializeBlock(state.blocks[k], el);
      for (var j = 0; j < bl.length; j++) out.push(bl[j]);
      if (k < state.blocks.length - 1) out.push('');
    }
    state.lines = out;
  }

  function walkText(el) {
    var s = '';
    walkNodes(el, function (n) {
      if (n === el) return false;
      if (n.nodeType === 3) { s += n.textContent; return false; }
      if (n.nodeName === 'BR') { s += '\n'; return false; }
      return false;
    });
    return s;
  }

  function serializeBlock(b, el) {
    switch (b.kind) {
      case 'para': {
        // 占位 <br>（空段落）不算内容
        if (el.children.length === 1 && el.children[0].nodeName === 'BR') return [''];
        var t = walkText(el);
        if (t === '') return [''];
        return t.split('\n');
      }
      case 'heading': {
        var m = (state.lines[b.start] || '').match(/^(#{1,6})/) || ['#'];
        return [m[1] + ' ' + walkText(el)];
      }
      case 'ul':
      case 'ol': {
        var lis = el.querySelectorAll('li');
        var out = [];
        for (var i = 0; i < lis.length; i++) {
          out.push((b.kind === 'ul' ? '- ' : (i + 1) + '. ') + walkText(lis[i]));
        }
        return out;
      }
      case 'quote': {
        var t3 = walkText(el).split('\n');
        return t3.map(function (l) { return '> ' + l; });
      }
      case 'code': {
        return ['```' + (b.lang || '')].concat(el.textContent.split('\n')).concat(['```']);
      }
      case 'hr':
      default:
        return ['---'];
    }
  }

  // 光标：DOM 选区 → 块索引 + 块内 DOM 文本偏移
  function getCaretBlockAndDom() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var node = sel.anchorNode;
    var off = sel.anchorOffset;
    if (!node) return null;
    var blkEl = node.nodeType === 1 ? closestBlock(node) : closestBlock(node.parentNode);
    if (!blkEl) return null;
    var domOff = 0;
    walkNodes(blkEl, function (n) {
      if (n === node) {
        if (n.nodeType === 3) domOff += off;
        return true;
      }
      if (n.nodeType === 3) { domOff += n.textContent.length; return false; }
      return false;
    });
    return { i: parseInt(blkEl.dataset.i, 10), domOff: domOff };
  }

  function closestBlock(node) {
    var n = node;
    while (n) {
      if (n.className && String(n.className).indexOf('md-blk') >= 0) return n;
      n = n.parentNode;
    }
    return null;
  }

  // 文档块解析（空文档兜底为一个空段落块，与渲染层一致）
  function docBlocks() {
    return docBlocksOf(state.lines);
  }
  function docBlocksOf(lines) {
    var blocks = MD.splitBlocks(lines);
    if (blocks.length === 0) blocks = [{ kind: 'para', start: 0, end: 0 }];
    return blocks;
  }

  // 源码偏移 ⇄ DOM 偏移
  function srcOffAt(i, domOff) {
    var map = state.maps[i];
    if (!map) return 0;
    var arr = map.srcAtDom;
    if (domOff >= arr.length - 1) return map.srcLen; // 块尾 → 源码末尾（含后置标记）
    if (domOff <= 0) return 0;
    return arr[domOff];
  }

  function domOffAt(i, srcOff) {
    var map = state.maps[i];
    if (!map) return 0;
    var arr = map.domAtSrc;
    if (srcOff < 0) srcOff = 0;
    if (srcOff >= arr.length) srcOff = arr.length - 1;
    return arr[srcOff];
  }

  // 把光标放到第 i 块的源码偏移 srcOff 处
  function placeCaret(i, srcOff) {
    var box = $('wysiwyg');
    if (i < 0) i = 0;
    if (i >= box.children.length) i = box.children.length - 1;
    var blkEl = box.children[i];
    if (!blkEl) return;
    var domOff = domOffAt(i, srcOff);
    blkEl.focus();
    var sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    var range = document.createRange();
    // 列表空项：边界恰在空 li 处时，光标放入该 li（保证输入进入正确列表项）
    if (blkEl.tagName === 'UL' || blkEl.tagName === 'OL') {
      var lis = blkEl.querySelectorAll('li');
      var pos = 0;
      for (var t = 0; t < lis.length; t++) {
        if (lis[t].textContent === '' && domOff === pos) {
          range.setStart(lis[t], 0);
          range.collapse(true);
          sel.addRange(range);
          return;
        }
        pos += lis[t].textContent.length;
      }
    }
    var placed = false;
    walkNodes(blkEl, function (n) {
      if (n.nodeType === 3) {
        if (domOff <= n.textContent.length) {
          range.setStart(n, domOff);
          placed = true;
          return true;
        }
        domOff -= n.textContent.length;
        return false;
      }
      return false;
    });
    if (!placed) {
      range.selectNodeContents(blkEl);
      range.collapse(false);
    } else {
      range.collapse(true);
    }
    sel.addRange(range);
  }

  // 输入后（兜底路径）：序列化 → 重渲染 → 用新映射把"视觉位置"换算为源码偏移并恢复光标
  function handleInput() {
    var pos = getCaretBlockAndDom(); // 旧 DOM 中的 (块索引, 块内视觉偏移)
    var i = pos ? pos.i : 0;
    var domOff = pos ? pos.domOff : 0;
    serializeDocument();
    pushUndo(i, domOff);
    renderDocument();
    if (i < 0) i = 0;
    if (i >= state.blocks.length) i = state.blocks.length - 1;
    var newMap = state.maps[i];
    var srcOff = newMap ? newMap.srcAtDom[Math.min(domOff, newMap.srcAtDom.length - 1)] : 0;
    placeCaret(i, srcOff);
    markDirty();
  }

  // 源码级操作（Enter/Backspace/Delete/粘贴）后应用结果并定位光标
  function applyOpResult(res) {
    state.lines = res.lines;
    renderDocument();
    var blocks = state.blocks;
    var bi = -1;
    for (var k = 0; k < blocks.length; k++) {
      if (blocks[k].start <= res.caret.line && res.caret.line < blocks[k].end) { bi = k; break; }
    }
    if (bi < 0) bi = Math.max(0, blocks.length - 1);
    var b = blocks[bi];
    var srcOffInBlock = 0;
    var rawLines = state.lines.slice(b.start, b.end);
    var lineOffset = res.caret.line - b.start;
    for (var j = 0; j < lineOffset && j < rawLines.length; j++) srcOffInBlock += rawLines[j].length + 1;
    var targetLine = rawLines[lineOffset] || '';
    var mm = targetLine.match(/^\s*([-*+]|\d+\.|>)\s+/);
    if (mm && res.caret.off === 0) srcOffInBlock += mm[0].length; // 行首光标落在标记之后
    srcOffInBlock += res.caret.off;
    placeCaret(bi, srcOffInBlock);
    markDirty();
  }

  function pushUndo(i, off) {
    var text = state.lines.join('\n');
    var last = state.undoStack[state.undoStack.length - 1];
    if (last && last.text === text) return;
    state.undoStack.push({ text: text, i: i || 0, off: off || 0 });
    if (state.undoStack.length > 100) state.undoStack.shift();
  }

  function undo() {
    var item = state.undoStack.pop();
    if (!item) return;
    // 若栈顶与当前相同，再弹一次
    if (state.lines.join('\n') === item.text && state.undoStack.length) {
      item = state.undoStack.pop();
      if (!item) return;
    }
    state.lines = item.text ? item.text.split('\n') : [];
    renderDocument();
    placeCaret(Math.min(item.i, state.blocks.length - 1), item.off);
    markDirty();
  }

  function currentText() {
    if (state.mode === 'source') return $('src-editor').value;
    return state.lines.join('\n');
  }

  /* ---------- 认证 ---------- */
  function doLogin() {
    var username = $('login-username').value.trim();
    var password = $('login-password').value;
    if (!username || !password) { authError('请输入用户名和密码'); return; }
    api('/auth/login', { method: 'POST', body: { username: username, password: password } })
      .then(function (data) {
        state.username = data.username || username;
        $('username').textContent = state.username;
        $('login-password').value = '';
        showMain();
        loadTree();
      })
      .catch(function (err) { authError(err.message); });
  }

  function doRegister() {
    var username = $('reg-username').value.trim();
    var password = $('reg-password').value;
    var password2 = $('reg-password2').value;
    if (!username || !password) { authError('请输入用户名和密码'); return; }
    if (password !== password2) { authError('两次输入的密码不一致'); return; }
    api('/auth/register', { method: 'POST', body: { username: username, password: password } })
      .then(function (data) {
        state.username = data.username || username;
        $('username').textContent = state.username;
        showMain();
        loadTree();
        toast('注册成功，已自动登录');
      })
      .catch(function (err) { authError(err.message); });
  }

  function doLogout() {
    api('/auth/logout', { method: 'POST' }).then(function () {
      showAuth();
    }).catch(function () { showAuth(); });
  }

  /* ---------- 目录树 ---------- */
  function loadTree() {
    api('/tree').then(function (tree) {
      state.tree = tree;
      renderTree();
    }).catch(function (err) { toast(err.message); });
  }

  function renderTree() {
    var box = $('tree');
    box.innerHTML = '';
    if (!state.tree || !state.tree.children) return;
    var root = document.createElement('ul');
    (state.tree.children || []).forEach(function (n) {
      root.appendChild(nodeEl(n, 0));
    });
    box.appendChild(root);
  }

  function nodeEl(n, depth) {
    var li = document.createElement('li');
    var row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = (8 + depth * 14) + 'px';

    var icon = document.createElement('span');
    var name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = n.name;
    name.title = n.path;
    row.appendChild(icon);
    row.appendChild(name);

    if (n.type === 'dir') {
      icon.className = 'tree-icon dir';
      icon.innerHTML = ICONS.folder;
      var sub = document.createElement('ul');
      sub.className = 'tree-children';
      (n.children || []).forEach(function (c) {
        sub.appendChild(nodeEl(c, depth + 1));
      });
      li.appendChild(row);
      li.appendChild(sub);
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        state.selectedDir = n.path;
        var collapsed = sub.classList.toggle('collapsed');
        icon.innerHTML = collapsed ? ICONS.folder : ICONS.folderOpen;
        highlight(row);
      });
    } else {
      icon.className = 'tree-icon file';
      icon.innerHTML = ICONS.file;
      li.appendChild(row);
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        state.selectedDir = '';
        highlight(row);
        openFile(n.path, n.name);
      });
    }

    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      showCtxMenu(e.clientX, e.clientY, n);
    });
    return li;
  }

  function highlight(row) {
    var rows = document.querySelectorAll('.tree-row');
    for (var i = 0; i < rows.length; i++) rows[i].classList.remove('active');
    row.classList.add('active');
  }

  /* ---------- 打开 / 保存 ---------- */
  function openFile(path, name) {
    if (state.dirty && state.currentPath) {
      if (!window.confirm('当前笔记有未保存的修改，确定放弃并切换吗？')) return;
    }
    api('/file?path=' + encodeURIComponent(path)).then(function (data) {
      state.currentPath = path;
      state.currentName = name || path;
      $('current-file').textContent = path;
      state.lines = (data.content || '') ? data.content.split('\n') : [];
      state.undoStack = [];
      $('src-editor').value = data.content || '';
      state.dirty = false;
      updateSaveStatus();
      if (state.mode === 'preview') renderDocument();
    }).catch(function (err) { toast(err.message); });
  }

  function save() {
    if (!state.currentPath) { toast('请先选择一篇笔记'); return; }
    api('/file', { method: 'PUT', body: { path: state.currentPath, content: currentText() } })
      .then(function () {
        state.dirty = false;
        updateSaveStatus();
        toast('已保存');
      })
      .catch(function (err) { toast('保存失败：' + err.message); });
  }

  function updateSaveStatus() {
    $('save-status').textContent = state.dirty ? '● 未保存' : '已保存';
    $('save-status').style.color = state.dirty ? '#f2b84b' : '#7fd08a';
  }

  /* ---------- 新建 / 重命名 / 删除 ---------- */
  function promptCreate(kind) {
    var label = kind === 'file' ? '笔记名称（自动补 .md 后缀）' : '文件夹名称';
    var name = window.prompt(label);
    if (!name) return;
    name = name.trim();
    if (!name) return;
    var path = state.selectedDir ? state.selectedDir + '/' + name : name;
    var url = kind === 'file' ? '/file' : '/dir';
    api(url, { method: 'POST', body: { path: path } })
      .then(function () {
        loadTree();
        if (kind === 'file') {
          var full = path.indexOf('.md') === -1 ? path + '.md' : path;
          openFile(full, name + '.md');
        }
        toast('已创建');
      })
      .catch(function (err) { toast(err.message); });
  }

  function renameNode(n) {
    var oldName = n.name;
    var newName = window.prompt('重命名为：', n.type === 'file' ? oldName.replace(/\.md$/, '') : oldName);
    if (!newName) return;
    newName = newName.trim();
    if (!newName || newName === (n.type === 'file' ? oldName.replace(/\.md$/, '') : oldName)) return;
    var parent = n.path.indexOf('/') === -1 ? '' : n.path.slice(0, n.path.lastIndexOf('/'));
    var to = parent ? parent + '/' + newName : newName;
    api('/move', { method: 'PUT', body: { from: n.path, to: to } })
      .then(function () {
        if (state.currentPath === n.path) {
          var newPath = to.indexOf('.md') === -1 ? to + '.md' : to;
          state.currentPath = newPath;
          $('current-file').textContent = newPath;
        }
        loadTree();
        toast('已重命名');
      })
      .catch(function (err) { toast(err.message); });
  }

  function deleteNode(n) {
    var msg = n.type === 'file'
      ? '确定删除笔记「' + n.name + '」？此操作不可恢复。'
      : '确定删除文件夹「' + n.name + '」？（仅空文件夹可删除）';
    if (!window.confirm(msg)) return;
    var url = n.type === 'file' ? '/file?path=' : '/dir?path=';
    api(url + encodeURIComponent(n.path), { method: 'DELETE' })
      .then(function () {
        if (state.currentPath === n.path) {
          state.currentPath = null;
          state.lines = [];
          state.undoStack = [];
          $('src-editor').value = '';
          renderDocument();
          $('current-file').textContent = '未选择笔记';
          state.dirty = false;
          updateSaveStatus();
        }
        loadTree();
        toast('已删除');
      })
      .catch(function (err) { toast(err.message); });
  }

  /* ---------- 右键菜单 ---------- */
  function showCtxMenu(x, y, n) {
    var menu = $('ctx-menu');
    menu.innerHTML = '';
    function item(text, fn, danger) {
      var d = document.createElement('div');
      d.textContent = text;
      if (danger) d.className = 'danger';
      d.addEventListener('click', function () {
        hideCtxMenu();
        fn();
      });
      menu.appendChild(d);
    }
    if (n.type === 'dir') {
      item('在此新建笔记', function () {
        state.selectedDir = n.path;
        promptCreate('file');
      });
      item('在此新建文件夹', function () {
        state.selectedDir = n.path;
        promptCreate('dir');
      });
    }
    item('重命名', function () { renameNode(n); });
    item('删除', function () { deleteNode(n); }, true);

    menu.classList.remove('hidden');
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
  }

  function hideCtxMenu() {
    $('ctx-menu').classList.add('hidden');
  }

  /* ---------- 事件绑定与初始化 ---------- */
  function bindEvents() {
    // 登录
    $('login-btn').addEventListener('click', doLogin);
    $('login-password').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });

    // 注册
    $('register-btn').addEventListener('click', doRegister);
    $('reg-password2').addEventListener('keydown', function (e) { if (e.key === 'Enter') doRegister(); });

    $('to-register').addEventListener('click', function () {
      $('login-form').classList.add('hidden');
      $('register-form').classList.remove('hidden');
      $('auth-error').classList.add('hidden');
    });
    $('to-login').addEventListener('click', function () {
      $('register-form').classList.add('hidden');
      $('login-form').classList.remove('hidden');
      $('auth-error').classList.add('hidden');
    });

    // 主界面
    $('logout-btn').addEventListener('click', doLogout);
    $('save-btn').addEventListener('click', save);
    $('refresh-btn').addEventListener('click', loadTree);
    $('new-file-btn').addEventListener('click', function () { promptCreate('file'); });
    $('new-dir-btn').addEventListener('click', function () { promptCreate('dir'); });
    $('theme-btn').addEventListener('click', toggleTheme);
    $('mode-btn').addEventListener('click', function () {
      setMode(state.mode === 'preview' ? 'source' : 'preview');
    });

    // 源码编辑器
    $('src-editor').addEventListener('input', markDirty);

    // ===== 所见即所得编辑器 =====
    var box = $('wysiwyg');

    box.addEventListener('input', function () {
      if (state.composing) return;
      handleInput(); // 兜底路径（不支持 beforeinput 的浏览器）
    });

    box.addEventListener('compositionstart', function () {
      state.composing = true;
      var pos = getCaretBlockAndDom();
      state.compStart = pos ? { i: pos.i, off: srcOffAt(pos.i, pos.domOff) } : null;
      state.compLines = state.lines.slice();
    });
    box.addEventListener('compositionend', function (e) {
      state.composing = false;
      var data = (e && e.data) || '';
      if (state.compStart && data) {
        // 以组合开始前的源码为基准插入最终文本（避免 DOM 回读丢失标记）
        var blocks = docBlocksOf(state.compLines);
        var res = EditorOps.insertTextOp(state.compLines, blocks, state.compStart.i, state.compStart.off, data);
        state.compStart = null;
        state.compLines = null;
        pushUndo(0, 0);
        applyOpResult(res);
      } else {
        handleInput();
      }
    });

    // 核心：在浏览器改动 DOM 之前拦截输入，直接映射回源码（源码是唯一事实来源，
    // 渲染 DOM 只是投影，从不回读），从根本上避免隐藏标记（#、**、- 等）丢失
    box.addEventListener('beforeinput', function (e) {
      if (state.composing || e.isComposing) return;
      var it = e.inputType;
      if (it === 'insertCompositionText' || it === 'insertFromPaste' || it === 'insertFromDrop') return;
      var pos = getCaretBlockAndDom();
      if (!pos) return;
      var srcOff = srcOffAt(pos.i, pos.domOff);
      var data = (e.data != null) ? e.data : '';
      var res = null;
      if (it === 'insertText' || it === 'insertLineBreak' || it === 'insertParagraph') {
        e.preventDefault();
        var blocks = docBlocks();
        res = EditorOps.insertTextOp(state.lines, blocks, pos.i, srcOff, data === '' ? '\n' : data);
      } else if (it === 'deleteContentBackward' || it === 'deleteWordBackward') {
        e.preventDefault();
        var blocks2 = docBlocks();
        res = EditorOps.backspaceOp(state.lines, blocks2, pos.i, srcOff);
      } else if (it === 'deleteContentForward' || it === 'deleteWordForward') {
        e.preventDefault();
        var blocks3 = docBlocks();
        res = EditorOps.deleteOp(state.lines, blocks3, pos.i, srcOff);
      } else {
        return;
      }
      pushUndo(pos.i, srcOff);
      applyOpResult(res);
    });

    box.addEventListener('keydown', function (e) {
      if (state.composing || e.isComposing) return;
      var pos = getCaretBlockAndDom();
      if (!pos) return;
      var srcOff = srcOffAt(pos.i, pos.domOff);
      var blockSrcLen = state.lines.slice(state.blocks[pos.i].start, state.blocks[pos.i].end).join('\n').length;

      // 源码是唯一事实来源：直接基于 state.lines 操作，不做 DOM 回读
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var blocks = docBlocks();
        var res = EditorOps.enterOp(state.lines, blocks, pos.i, srcOff);
        pushUndo(pos.i, srcOff);
        applyOpResult(res);
      } else if (e.key === 'Backspace' && srcOff === 0) {
        e.preventDefault();
        var blocks2 = docBlocks();
        var res2 = EditorOps.backspaceOp(state.lines, blocks2, pos.i, 0);
        pushUndo(pos.i, 0);
        applyOpResult(res2);
      } else if (e.key === 'Delete' && srcOff >= blockSrcLen) {
        e.preventDefault();
        var blocks3 = docBlocks();
        var res3 = EditorOps.deleteOp(state.lines, blocks3, pos.i, blockSrcLen);
        pushUndo(pos.i, blockSrcLen);
        applyOpResult(res3);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    });

    box.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      var pos = getCaretBlockAndDom();
      if (!pos || !text) return;
      var srcOff = srcOffAt(pos.i, pos.domOff);
      var blocks = docBlocks();
      var res = EditorOps.insertTextOp(state.lines, blocks, pos.i, srcOff, text);
      pushUndo(pos.i, srcOff);
      applyOpResult(res);
    });

    // 快捷键
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        save();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        setMode(state.mode === 'preview' ? 'source' : 'preview');
      }
    });
    document.addEventListener('click', hideCtxMenu);
  }

  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      updateSaveStatus();
    }
  }

  function init() {
    try {
      if (localStorage.getItem('onlinenote-mode') === 'source') state.mode = 'source';
    } catch (e) {}
    if (state.mode === 'source') {
      $('src-editor').classList.remove('hidden');
      $('wysiwyg').classList.add('hidden');
    } else {
      renderDocument();
    }
    updateThemeBtn();
    updateModeBtn();
    updateModeHint();
    bindEvents();
    api('/auth/me').then(function (data) {
      state.username = data.username || '';
      $('username').textContent = state.username;
      showMain();
      loadTree();
    }).catch(function () {
      showAuth();
    });
  }

  init();
})();
