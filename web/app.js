/**
 * OnlineNote 前端逻辑（零构建）
 */
(function () {
  'use strict';

  var state = {
    tree: null,
    currentPath: null,   // 当前打开的文件（含 .md）
    currentName: '',
    selectedDir: '',     // 工具栏"新建"作用的目录（"" 表示根目录）
    dirty: false,
    username: ''
  };

  function $(id) { return document.getElementById(id); }

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

  /* ---------- 初始化 ---------- */
  function init() {
    api('/auth/me').then(function (data) {
      state.username = data.username || '';
      $('username').textContent = state.username;
      showMain();
      loadTree();
    }).catch(function () {
      showAuth();
    });
    bindEvents();
  }

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

    var editor = $('editor');
    editor.addEventListener('input', function () {
      state.dirty = true;
      updateSaveStatus();
      debouncePreview();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        save();
      }
    });
    document.addEventListener('click', hideCtxMenu);
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
    name.textContent = n.type === 'dir' ? n.name + '/' : n.name;
    name.title = n.path;
    row.appendChild(icon);
    row.appendChild(name);

    if (n.type === 'dir') {
      icon.className = 'tree-icon dir';
      icon.textContent = '▸';
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        state.selectedDir = n.path;
        icon.classList.toggle('open');
        var children = li.querySelector('.tree-children');
        if (children) children.classList.toggle('collapsed');
        highlight(row);
      });
      var sub = document.createElement('ul');
      sub.className = 'tree-children';
      (n.children || []).forEach(function (c) {
        sub.appendChild(nodeEl(c, depth + 1));
      });
      li.appendChild(row);
      li.appendChild(sub);
    } else {
      icon.className = 'tree-icon file';
      icon.textContent = '📄';
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        state.selectedDir = '';
        highlight(row);
        openFile(n.path, n.name);
      });
      li.appendChild(row);
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
    api('/file?path=' + encodeURIComponent(path)).then(function (data) {
      state.currentPath = path;
      state.currentName = name || path;
      $('editor').value = data.content || '';
      $('current-file').textContent = path;
      state.dirty = false;
      updateSaveStatus();
      renderPreview();
    }).catch(function (err) { toast(err.message); });
  }

  function save() {
    if (!state.currentPath) { toast('请先选择一篇笔记'); return; }
    api('/file', { method: 'PUT', body: { path: state.currentPath, content: $('editor').value } })
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

  /* ---------- 预览 ---------- */
  function debouncePreview() {
    clearTimeout(debouncePreview._t);
    debouncePreview._t = setTimeout(renderPreview, 300);
  }

  function renderPreview() {
    $('preview').innerHTML = window.renderMarkdown($('editor').value);
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
          $('editor').value = '';
          $('current-file').textContent = '未选择笔记';
          $('preview').innerHTML = '';
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

  init();
})();
