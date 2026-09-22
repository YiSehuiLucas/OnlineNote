/**
 * OnlineNote 前端逻辑（v1.4，零构建）
 * - 编辑体验等同本地 Markdown 文件：一个大的文本框，Enter 即换行
 * - 单窗格「源码 ⇄ 预览」切换（Ctrl+/ 或顶部按钮），预览为纯渲染效果
 * - 预览中点击任意位置会跳回源码模式并把光标定位到对应行
 * - SVG 图标目录树、夜间主题切换（localStorage 记忆）
 */
(function () {
  'use strict';

  var state = {
    tree: null,
    currentPath: null,   // 当前打开的文件（含 .md）
    currentName: '',
    selectedDir: '',     // 工具栏"新建"作用的目录（"" 表示根目录）
    dirty: false,
    username: '',
    mode: 'preview'      // 'source' | 'preview'
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

  /* ---------- 源码 / 预览模式 ---------- */
  function updateModeBtn() {
    var btn = $('mode-btn');
    btn.innerHTML = state.mode === 'preview'
      ? ICONS.code + '<span>源码</span>'
      : ICONS.eye + '<span>预览</span>';
  }

  function updateModeHint() {
    $('mode-hint').textContent = state.mode === 'preview'
      ? '预览模式 · 点击正文或 Ctrl+/ 进入编辑'
      : '源码模式 · Ctrl+/ 查看预览';
  }

  function setMode(m) {
    if (m === state.mode) return;
    state.mode = m;
    if (m === 'source') {
      $('src-editor').classList.remove('hidden');
      $('wysiwyg').classList.add('hidden');
    } else {
      renderPreview();
      $('wysiwyg').classList.remove('hidden');
      $('src-editor').classList.add('hidden');
    }
    try { localStorage.setItem('onlinenote-mode', m); } catch (e) {}
    updateModeBtn();
    updateModeHint();
  }

  // 渲染预览（纯渲染效果，只读）
  function renderPreview() {
    var box = $('wysiwyg');
    var text = $('src-editor').value;
    if (text.trim() === '') {
      box.innerHTML = '<p class="blk-empty">这里还没有内容，点击进入编辑…</p>';
    } else {
      box.innerHTML = MD.renderMarkdown(text);
    }
  }

  // 预览中点击 → 切到源码，并把光标定位到点击位置对应的行
  function jumpToSource(e) {
    var ta = $('src-editor');
    var box = $('wysiwyg');
    var rect = box.getBoundingClientRect();
    var y = (e && e.clientY !== undefined ? e.clientY : 0) - rect.top + box.scrollTop;
    var lineIdx = Math.max(0, Math.floor(y / 27)); // 近似渲染行高
    setMode('source');
    var lines = ta.value.split('\n');
    if (lineIdx >= lines.length) lineIdx = Math.max(0, lines.length - 1);
    var pos = 0;
    for (var k = 0; k < lineIdx; k++) pos += lines[k].length + 1;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.scrollTop = Math.max(0, lineIdx * 24 - ta.clientHeight / 2);
  }

  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      updateSaveStatus();
    }
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
      $('src-editor').value = data.content || '';
      state.dirty = false;
      updateSaveStatus();
      if (state.mode === 'preview') renderPreview();
    }).catch(function (err) { toast(err.message); });
  }

  function save() {
    if (!state.currentPath) { toast('请先选择一篇笔记'); return; }
    api('/file', { method: 'PUT', body: { path: state.currentPath, content: $('src-editor').value } })
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
          $('src-editor').value = '';
          renderPreview();
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

    // 源码编辑器：输入即脏标记
    $('src-editor').addEventListener('input', markDirty);

    // 预览：点击 → 跳回源码对应位置
    $('wysiwyg').addEventListener('click', function (e) {
      jumpToSource(e);
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
