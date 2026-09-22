/**
 * OnlineNote 前端逻辑（v2.0，零构建）
 * 编辑器架构：**AST 为唯一事实来源**（参照 goldmark）——
 *   语法标记不存在于模型中（标题=节点属性、加粗=strong 节点），
 *   渲染与序列化均从 AST 生成，DOM 文本与 AST 文本一一对应。
 * 普通打字零重渲染（光标完全交给浏览器原生行为）；
 * 仅当格式结构变化（如 ** 闭合）或块类型转换时才重渲染并恢复光标（纯文本偏移）。
 * Ctrl+/ 源码模式、Ctrl+Z 撤销、Ctrl+S 保存、夜间主题、SVG 目录树。
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
    mode: 'preview',
    ast: { kind: 'document', blocks: [] },   // 文档 AST（唯一模型）
    undoStack: [],                           // [{text, caret}]
    composing: false
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
      $('src-editor').value = MD.serialize(state.ast);
      $('src-editor').classList.remove('hidden');
      $('wysiwyg').classList.add('hidden');
    } else {
      // 源码未改动则保留原 AST（避免空段落等信息在往返解析中丢失）；
      // 只有用户手动编辑过源码才重新解析
      var val = $('src-editor').value;
      if (val !== MD.serialize(state.ast)) {
        state.ast = MD.parse(val);
      }
      renderDocument();
      $('wysiwyg').classList.remove('hidden');
      $('src-editor').classList.add('hidden');
    }
    state.mode = m;
    try { localStorage.setItem('onlinenote-mode', m); } catch (e) {}
    updateModeBtn();
    updateModeHint();
  }

  /* ================= AST 编辑器核心 ================= */

  function renderDocument() {
    var box = $('wysiwyg');
    if (state.ast.blocks.length === 0) {
      state.ast.blocks.push({ kind: 'paragraph', children: [] });
    }
    box.innerHTML = '';
    state.ast.blocks.forEach(function (b, i) {
      var holder = document.createElement('div');
      holder.innerHTML = MD.renderBlockHTML(b);
      var el = holder.firstChild || document.createElement('p');
      el.className = 'md-blk';
      el.dataset.i = i;
      if (b.kind !== 'hr') el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'false');
      box.appendChild(el);
    });
  }

  // 块元素的内部 HTML（原位更新用）
  function blockInnerHTML(b) {
    switch (b.kind) {
      case 'heading': return MD.renderInlines(b.children);
      case 'paragraph': return MD.renderInlines(b.children) || '<br>';
      case 'quote': return MD.renderInlines(b.children);
      case 'code': return '<code>' + MD.renderInlines([{ kind: 'text', lit: b.text }]) + '</code>';
      case 'list':
        return b.items.map(function (it) {
          return '<li>' + (MD.renderInlines(it.children) || '<br>') + '</li>';
        }).join('');
      default: return '';
    }
  }

  function closestBlock(node) {
    var n = node;
    while (n) {
      if (n.className && String(n.className).indexOf('md-blk') >= 0) return n;
      n = n.parentNode;
    }
    return null;
  }

  // 子树纯文本长度（<br> 记 0）
  function subtreeTextLen(node) {
    if (node.nodeType === 3) return node.textContent.length;
    var len = 0;
    for (var i = 0; i < node.childNodes.length; i++) {
      var c = node.childNodes[i];
      if (c.nodeType === 3) len += c.textContent.length;
      else if (c.tagName !== 'BR') len += subtreeTextLen(c);
    }
    return len;
  }

  // root 内 node/off 处 → DOM 文本偏移
  function textOffsetIn(root, node, off) {
    var pos = 0, found = false;
    (function walk(el) {
      for (var i = 0; i < el.childNodes.length && !found; i++) {
        var c = el.childNodes[i];
        if (c === node) {
          if (c.nodeType === 3) pos += off;
          else {
            for (var j = 0; j < off && j < c.childNodes.length; j++) pos += subtreeTextLen(c.childNodes[j]);
          }
          found = true;
          return;
        }
        if (c.nodeType === 3) pos += c.textContent.length;
        else walk(c);
      }
    })(root);
    return pos;
  }

  // 当前选区 → { idx, itemIdx?, off }
  function getCaret() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var node = sel.anchorNode;
    var off = sel.anchorOffset;
    if (!node) return null;
    var blkEl = closestBlock(node.nodeType === 1 ? node : node.parentNode);
    if (!blkEl) return null;
    var idx = parseInt(blkEl.dataset.i, 10);
    if (blkEl.tagName === 'UL' || blkEl.tagName === 'OL') {
      var li = node.nodeType === 1 ? node : node.parentNode;
      while (li && li.tagName !== 'LI') li = li.parentNode;
      var lis = blkEl.querySelectorAll('li');
      var itemIdx = -1;
      for (var k = 0; k < lis.length; k++) {
        if (lis[k] === li) { itemIdx = k; break; }
      }
      if (itemIdx < 0) itemIdx = 0;
      return { idx: idx, itemIdx: itemIdx, off: textOffsetIn(li || blkEl, node, off) };
    }
    return { idx: idx, off: textOffsetIn(blkEl, node, off) };
  }

  // 在 root 内偏移 off 处放置光标（真实 Range/Selection）
  function placeCaretIn(root, off) {
    var range = document.createRange();
    var sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    var placed = false;
    (function walk(el) {
      for (var i = 0; i < el.childNodes.length && !placed; i++) {
        var c = el.childNodes[i];
        if (c.nodeType === 3) {
          if (off <= c.textContent.length) { range.setStart(c, off); placed = true; return; }
          off -= c.textContent.length;
        } else if (c.tagName !== 'BR') {
          walk(c);
        }
      }
    })(root);
    if (!placed) {
      range.selectNodeContents(root);
      range.collapse(false);
    } else {
      range.collapse(true);
    }
    sel.addRange(range);
  }

  function placeCaretFrom(caret) {
    var box = $('wysiwyg');
    var blkEl = box.children[caret.idx];
    if (!blkEl) return;
    blkEl.focus();
    if (caret.itemIdx >= 0) {
      var lis = blkEl.querySelectorAll('li');
      var li = lis[caret.itemIdx];
      if (li) placeCaretIn(li, caret.off);
      else placeCaretIn(blkEl, 0);
    } else {
      placeCaretIn(blkEl, caret.off);
    }
  }

  function blockTextLen(b, itemIdx) {
    if (b.kind === 'code') return b.text.length;
    if (b.kind === 'list') {
      var it = b.items[itemIdx >= 0 ? itemIdx : b.items.length - 1];
      return it ? MD.inlineTextLen(it.children) : 0;
    }
    return MD.inlineTextLen(b.children);
  }

  // DOM → 块级 AST 节点（往返重解析：让 ** 等标记重新形成行内结构）
  function blockFromDOM(el, old) {
    function inlines(el2) {
      return MD.parseInlines(MD.serializeInlines(MD.inlinesFromDOM(el2)));
    }
    switch (old.kind) {
      case 'heading': return { kind: 'heading', level: old.level, children: inlines(el) };
      case 'paragraph': return { kind: 'paragraph', children: inlines(el) };
      case 'quote': return { kind: 'quote', children: inlines(el) };
      case 'code': return { kind: 'code', lang: old.lang, text: el.textContent };
      case 'list': {
        var lis = el.querySelectorAll('li');
        var items = [];
        for (var k = 0; k < lis.length; k++) {
          items.push({ kind: 'listitem', children: inlines(lis[k]) });
        }
        return { kind: 'list', ordered: old.ordered, items: items };
      }
      default: return old;
    }
  }

  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      updateSaveStatus();
    }
  }

  // 行内结构签名（仅元素种类序列，与内容长度无关）
  function structureSig(b) {
    if (b.kind === 'code') return 'code';
    if (b.kind === 'list') return b.items.map(function (it) { return structureSigList(it.children); }).join('|');
    return structureSigList(b.children);
  }
  function structureSigList(nodes) {
    return nodes.map(function (n) { return n.kind; }).join(',');
  }

  // 输入后：重建当前块 → 更新 AST → 按需重渲染/恢复光标
  function handleInput() {
    var pos = getCaret();
    if (!pos) return;
    var idx = pos.idx;
    var old = state.ast.blocks[idx];
    if (!old) return;
    var blkEl = $('wysiwyg').children[idx];
    if (!blkEl) return;
    var newBlock = blockFromDOM(blkEl, old);

    var countBefore = state.ast.blocks.length;
    state.ast.blocks[idx] = newBlock;
    var normalized = EditorOps.normalizeBlock(state.ast.blocks, idx);
    pushUndo(pos);

    if (state.ast.blocks.length === countBefore && !normalized) {
      if (structureSig(state.ast.blocks[idx]) === structureSig(old)) {
        // 行内结构未变：无需重渲染，光标保持浏览器原生位置
        markDirty();
        return;
      }
      // 行内结构变化（如 ** 闭合）：原位更新该块 + 按文本偏移恢复光标
      blkEl.innerHTML = blockInnerHTML(state.ast.blocks[idx]);
      if (pos.itemIdx >= 0) {
        var lis2 = blkEl.querySelectorAll('li');
        var li2 = lis2[pos.itemIdx];
        if (li2) placeCaretIn(li2, pos.off);
        else placeCaretIn(blkEl, 0);
      } else {
        placeCaretIn(blkEl, pos.off);
      }
      blkEl.focus();
    } else {
      // 结构变化（类型转换/列表合并）：整文档重渲染，光标落在受影响块末尾
      renderDocument();
      var ni = state.ast.blocks.indexOf(newBlock);
      if (ni < 0) ni = Math.min(idx, state.ast.blocks.length - 1);
      if (ni >= 0) {
        var b = state.ast.blocks[ni];
        var el2 = $('wysiwyg').children[ni];
        placeCaretIn(el2, blockTextLen(b, -1));
        el2.focus();
      }
    }
    markDirty();
  }

  // 结构操作（回车/退格/删除/粘贴）后应用并定位光标
  function applyOpResult(res) {
    state.ast.blocks = res.blocks;
    renderDocument();
    placeCaretFrom(res.caret);
    markDirty();
  }

  function pushUndo(caret) {
    var text = MD.serialize(state.ast);
    var last = state.undoStack[state.undoStack.length - 1];
    if (last && last.text === text) return;
    state.undoStack.push({ text: text, caret: caret });
    if (state.undoStack.length > 100) state.undoStack.shift();
  }

  function undo() {
    var item = state.undoStack.pop();
    if (!item) return;
    if (MD.serialize(state.ast) === item.text && state.undoStack.length) {
      item = state.undoStack.pop();
      if (!item) return;
    }
    state.ast = MD.parse(item.text);
    renderDocument();
    var caret = item.caret || { idx: 0, off: 0 };
    if (caret.idx >= state.ast.blocks.length) caret = { idx: state.ast.blocks.length - 1, off: 0 };
    if (caret.idx >= 0) placeCaretFrom(caret);
    markDirty();
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
      state.ast = MD.parse(data.content || '');
      state.undoStack = [];
      $('src-editor').value = data.content || '';
      state.dirty = false;
      updateSaveStatus();
      if (state.mode === 'preview') renderDocument();
    }).catch(function (err) { toast(err.message); });
  }

  function save() {
    if (!state.currentPath) { toast('请先选择一篇笔记'); return; }
    var text = state.mode === 'source' ? $('src-editor').value : MD.serialize(state.ast);
    api('/file', { method: 'PUT', body: { path: state.currentPath, content: text } })
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
          state.ast = { kind: 'document', blocks: [] };
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

    // ===== AST 所见即所得编辑器 =====
    var box = $('wysiwyg');

    // 普通输入：重建当前块 AST；内容未变则不重渲染（光标保持原生位置）
    box.addEventListener('input', function () {
      if (state.composing) return;
      handleInput();
    });

    box.addEventListener('compositionstart', function () { state.composing = true; });
    box.addEventListener('compositionend', function () {
      state.composing = false;
      handleInput();
    });

    box.addEventListener('keydown', function (e) {
      if (state.composing || e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var pos = getCaret();
        if (!pos) return;
        var res = EditorOps.enterInBlock(state.ast.blocks, pos.idx, pos.itemIdx, pos.off);
        pushUndo(pos);
        applyOpResult(res);
      } else if (e.key === 'Backspace' && !e.shiftKey) {
        var pos2 = getCaret();
        if (!pos2) return;
        if (pos2.off === 0) {
          e.preventDefault();
          var res2 = EditorOps.backspaceAtStart(state.ast.blocks, pos2.idx, pos2.itemIdx);
          pushUndo(pos2);
          applyOpResult(res2);
        }
      } else if (e.key === 'Delete' && !e.shiftKey) {
        var pos3 = getCaret();
        if (!pos3) return;
        var endOff = blockTextLen(state.ast.blocks[pos3.idx], pos3.itemIdx);
        if (pos3.off >= endOff) {
          e.preventDefault();
          var res3 = EditorOps.deleteAtEnd(state.ast.blocks, pos3.idx, pos3.itemIdx);
          pushUndo(pos3);
          applyOpResult(res3);
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    });

    box.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      var pos = getCaret();
      if (!pos || !text) return;
      var res = EditorOps.insertTextInBlock(state.ast.blocks, pos.idx, pos.itemIdx, pos.off, text);
      pushUndo(pos);
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
