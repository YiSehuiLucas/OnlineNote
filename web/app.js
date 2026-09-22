/**
 * OnlineNote 前端逻辑（v1.3，零构建）
 * - Typora 风格连续编辑：预览中点击任意块直接输入 Markdown 语法，
 *   Enter 行尾换段 / 行中拆分，方向键在块间无缝移动，Backspace 合并段落
 * - 源码 / 预览模式切换（Ctrl+/）、SVG 图标目录树、夜间主题
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
    mode: 'preview',     // 'source' | 'preview'
    lines: [],           // 当前文档行（编辑模型）
    blocks: [],          // [{kind, start, end}]
    editingIdx: -1,      // 正在编辑的块索引（与 DOM 子节点一一对应）
    virtual: null        // 虚拟空块 {div, pos}
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

  /* ---------- 模式切换 ---------- */
  function updateModeBtn() {
    var btn = $('mode-btn');
    btn.innerHTML = state.mode === 'preview'
      ? ICONS.code + '<span>源码</span>'
      : ICONS.eye + '<span>预览</span>';
  }

  function setMode(m) {
    if (m === state.mode) return;
    commitActiveBlock();
    if (m === 'source') {
      $('src-editor').value = state.lines.join('\n');
      $('src-editor').classList.remove('hidden');
      $('wysiwyg').classList.add('hidden');
    } else {
      setDocument($('src-editor').value);
      renderBlocks();
      $('wysiwyg').classList.remove('hidden');
      $('src-editor').classList.add('hidden');
    }
    state.mode = m;
    try { localStorage.setItem('onlinenote-mode', m); } catch (e) {}
    updateModeBtn();
  }

  /* ---------- 文档模型 ---------- */
  function setDocument(text) {
    state.lines = text ? text.split('\n') : [];
    state.blocks = MD.splitBlocks(state.lines);
    state.editingIdx = -1;
    state.virtual = null;
  }

  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      updateSaveStatus();
    }
  }

  function currentText() {
    commitActiveBlock();
    if (state.mode === 'source') return $('src-editor').value;
    return state.lines.join('\n');
  }

  /* ================= 编辑器核心：连续块编辑 ================= */

  function blockClass(b) {
    var cls = 'blk blk-' + b.kind;
    if (b.kind === 'heading') {
      var m = (state.lines[b.start] || '').match(/^(#{1,6})/);
      cls += ' blk-h' + (m ? m[1].length : 1);
    }
    return cls;
  }

  function renderBlocks() {
    var box = $('wysiwyg');
    box.innerHTML = '';
    state.blocks.forEach(function (b) {
      var div = document.createElement('div');
      div.className = blockClass(b);
      div.dataset.start = b.start;
      div.innerHTML = MD.renderBlock(state.lines.slice(b.start, b.end), b.kind);
      box.appendChild(div);
    });
    if (state.blocks.length === 0) {
      box.innerHTML = '<p class="blk-empty">这里还没有内容，点击任意位置开始写作…</p>';
    }
  }

  // 进入块编辑：i 为块索引（与 DOM 子节点一一对应），caret 为 'start' | 'end' | 数字 | null
  function editBlockByIdx(i, caret, clickEvent) {
    var b = state.blocks[i];
    if (!b || b.kind === 'hr') return;
    state.editingIdx = i;
    var div = $('wysiwyg').children[i];
    var raw = state.lines.slice(b.start, b.end);

    var ta = document.createElement('textarea');
    ta.className = 'blk-editor';
    ta.value = raw.join('\n');
    div.innerHTML = '';
    div.appendChild(ta);
    autosize(ta);

    var caretPos = 0;
    if (caret === 'end') {
      caretPos = ta.value.length;
    } else if (caret === 'start') {
      caretPos = 0;
    } else if (typeof caret === 'number') {
      caretPos = Math.max(0, Math.min(caret, ta.value.length));
    } else if (clickEvent && clickEvent.clientY !== undefined) {
      // 按点击的纵向位置估算所在行
      var rect = div.getBoundingClientRect();
      var nLines = raw.length || 1;
      var lineH = Math.max(rect.height / nLines, 1);
      var lineIdx = Math.floor((clickEvent.clientY - rect.top) / lineH);
      if (lineIdx < 0) lineIdx = 0;
      if (lineIdx >= nLines) lineIdx = nLines - 1;
      caretPos = 0;
      for (var p = 0; p < lineIdx; p++) caretPos += raw[p].length + 1;
      caretPos = Math.min(caretPos, ta.value.length);
    }
    ta.focus();
    ta.setSelectionRange(caretPos, caretPos);

    ta.addEventListener('keydown', function (ev) {
      if (ev.isComposing) return;
      var handled = false;
      if (ev.key === 'Enter' && !ev.shiftKey && b.kind !== 'code') {
        ev.preventDefault();
        var cp = ta.selectionStart;
        if (cp === ta.value.length) {
          // 行尾回车：提交并在下方开新段，继续输入
          var endPos = commitBlockSurgical(i, ta.value);
          if (endPos !== null) insertVirtualBlock(endPos);
        } else {
          splitBlock(i, cp);
        }
        handled = true;
      } else if (ev.key === 'Backspace' && ta.selectionStart === 0) {
        ev.preventDefault();
        mergeWithPrev(i, ta.value);
        handled = true;
      } else if (ev.key === 'Delete' && ta.selectionEnd === ta.value.length) {
        ev.preventDefault();
        mergeWithNext(i, ta.value);
        handled = true;
      } else if (ev.key === 'ArrowUp') {
        if (caretLineOf(ta) === 0 && ta.selectionStart === ta.selectionEnd) {
          ev.preventDefault();
          navigateTo(i, ta.value, -1, 'end');
          handled = true;
        }
      } else if (ev.key === 'ArrowDown') {
        if (caretLineOf(ta) === lastLineOf(ta) && ta.selectionStart === ta.selectionEnd) {
          ev.preventDefault();
          navigateTo(i, ta.value, 1, 'start');
          handled = true;
        }
      } else if (ev.key === 'ArrowLeft') {
        if (ta.selectionStart === 0) {
          ev.preventDefault();
          navigateTo(i, ta.value, -1, 'end');
          handled = true;
        }
      } else if (ev.key === 'ArrowRight') {
        if (ta.selectionStart === ta.value.length) {
          ev.preventDefault();
          navigateTo(i, ta.value, 1, 'start');
          handled = true;
        }
      } else if (ev.key === 'Escape') {
        commitBlockSurgical(i, ta.value);
        handled = true;
      }
      if (handled) autosize(ta);
    });
    ta.addEventListener('input', function () { autosize(ta); markDirty(); });
    ta.addEventListener('blur', function () {
      setTimeout(function () { commitBlockSurgical(i, ta.value); }, 150);
    });
  }

  function caretLineOf(ta) {
    return ta.value.slice(0, ta.selectionStart).split('\n').length - 1;
  }
  function lastLineOf(ta) {
    return ta.value.split('\n').length - 1;
  }

  // 提交块编辑（原位更新，不整页重绘；空内容则删除块）。返回新块结束行号，块被删除返回 null。
  function commitBlockSurgical(i, value) {
    if (state.editingIdx !== i) return null;
    state.editingIdx = -1;
    var b = state.blocks[i];
    if (!b) return null;
    var t = value || '';
    var newLines = t.replace(/[\s\n]/g, '') === '' ? [] : t.split('\n');
    var before = state.lines.slice(0, b.start);
    var after = state.lines.slice(b.end);
    state.lines = before.concat(newLines, after);
    state.blocks = MD.splitBlocks(state.lines);
    markDirty();

    var box = $('wysiwyg');
    if (box.children.length === state.blocks.length && state.blocks.length > 0) {
      // 块数不变：原位更新当前块
      var div = box.children[i];
      var nb = state.blocks[i];
      div.className = blockClass(nb);
      div.dataset.start = nb.start;
      div.innerHTML = MD.renderBlock(state.lines.slice(nb.start, nb.end), nb.kind);
      if (newLines.length === 0) return null;
      return nb.start + nb.end - nb.start; // 新块结束行号
    }
    renderBlocks();
    if (newLines.length === 0) return null;
    // 全量重绘后按起始行重新定位
    var target = null;
    for (var k = 0; k < state.blocks.length; k++) {
      if (state.blocks[k].start <= b.start && b.start < state.blocks[k].end) { target = state.blocks[k]; break; }
    }
    return target ? target.end : (b.start + newLines.length);
  }

  // 行中回车：在光标处拆分为两个块（B 继续编辑）
  function splitBlock(i, caret) {
    var b = state.blocks[i];
    var div = $('wysiwyg').children[i];
    var ta = div.querySelector('textarea');
    if (!ta) return;
    state.editingIdx = -1;
    var value = ta.value;
    var aText = value.slice(0, caret);
    var bText = value.slice(caret);
    var kindB = b.kind === 'heading' ? 'para' : b.kind;
    var aLines = aText.split('\n');
    var bLines = bText.split('\n');
    // B 行需要时补语法标记（列表/引用拆分）
    if (kindB === 'ul') bLines = bLines.map(function (l) { return l === '' ? '-' : (/^\s*[-*+]\s+/.test(l) ? l : '- ' + l); });
    if (kindB === 'ol') bLines = bLines.map(function (l, idx) { return /^\s*\d+\.\s+/.test(l) ? l : (idx + 1) + '. ' + l; });
    if (kindB === 'quote') bLines = bLines.map(function (l) { return /^>\s?/.test(l) ? l : '> ' + l; });

    var before = state.lines.slice(0, b.start);
    var after = state.lines.slice(b.end);
    var aEmpty = aText.replace(/[\s\n]/g, '') === '';
    var bEmpty = bText.replace(/[\s\n]/g, '') === '';
    var sameListish = (b.kind === 'ul' || b.kind === 'ol' || b.kind === 'quote');
    var newLines = [];
    if (!aEmpty && !bEmpty) {
      // 列表/引用拆分不加空行（保持在同一个列表/引用块内）；其余块之间加空行
      newLines = sameListish ? aLines.concat(bLines) : aLines.concat([''], bLines);
    } else if (!aEmpty) {
      newLines = aLines;
    } else if (!bEmpty) {
      newLines = bLines;
    }
    state.lines = before.concat(newLines, after);
    state.blocks = MD.splitBlocks(state.lines);
    renderBlocks();
    markDirty();
    // 定位拆分点后的内容所在块，并把光标放在对应行首
    var bStartLine = b.start + (aEmpty ? 0 : aLines.length);
    var bi = -1;
    for (var k = 0; k < state.blocks.length; k++) {
      if (state.blocks[k].start <= bStartLine && bStartLine < state.blocks[k].end) { bi = k; break; }
    }
    if (bi >= 0) {
      var blk = state.blocks[bi];
      var caretAt = 0;
      if (bStartLine > blk.start) {
        caretAt = state.lines.slice(blk.start, bStartLine).join('\n').length + 1;
      }
      editBlockByIdx(bi, caretAt);
    } else if (bEmpty) {
      insertVirtualBlock(bStartLine);
    }
  }

  // Backspace 在行首：合并到上一块（或仅导航；当前块为空则删除）
  function mergeWithPrev(i, value) {
    var b = state.blocks[i];
    if (i === 0) {
      if (value.replace(/[\s\n]/g, '') === '') {
        // 文档首个块为空：提交（删除）后重新渲染为空文档
        commitBlockSurgical(i, '');
      }
      return;
    }
    var prev = state.blocks[i - 1];
    var prevRaw = state.lines.slice(prev.start, prev.end);
    var curLines = value.split('\n');

    if (prev.kind === 'hr') {
      // 删除分隔线
      state.lines = state.lines.slice(0, prev.start).concat(state.lines.slice(prev.end));
      state.blocks = MD.splitBlocks(state.lines);
      renderBlocks();
      markDirty();
      var ni = i - 1;
      if (ni < state.blocks.length) editBlockByIdx(ni, 'start');
      return;
    }

    if (value.replace(/[\s\n]/g, '') === '') {
      // 当前块为空：删除它，光标回到上一块末尾
      state.lines = state.lines.slice(0, b.start).concat(state.lines.slice(b.end));
      state.blocks = MD.splitBlocks(state.lines);
      renderBlocks();
      markDirty();
      if (i - 1 < state.blocks.length) editBlockByIdx(i - 1, 'end');
      return;
    }

    var sameGroup = (prev.kind === b.kind) ||
      ((prev.kind === 'para' || prev.kind === 'heading') && (b.kind === 'para' || b.kind === 'heading'));
    if (!sameGroup) {
      // 类型不同：仅把光标移到上一块末尾
      commitBlockSurgical(i, value);
      if (i - 1 < state.blocks.length) editBlockByIdx(i - 1, 'end');
      return;
    }

    // 同类型合并：prev + 当前（文本类用空格连接边界行）
    var merged = prevRaw.concat(curLines);
    var caretAt = prevRaw.join('\n').length;
    if (prev.kind === 'para' || prev.kind === 'heading') {
      merged[merged.length - curLines.length - 1] = prevRaw[prevRaw.length - 1] + ' ' + curLines[0];
      merged.splice(merged.length - curLines.length, 1);
      caretAt += 1;
    }
    state.lines = state.lines.slice(0, prev.start)
      .concat(merged, state.lines.slice(b.end));
    state.blocks = MD.splitBlocks(state.lines);
    renderBlocks();
    markDirty();
    var mi = i - 1;
    if (mi < state.blocks.length) editBlockByIdx(mi, caretAt);
  }

  // Delete 在行尾：合并下一块（或仅导航；当前块为空则删除）
  function mergeWithNext(i, value) {
    var b = state.blocks[i];
    if (i >= state.blocks.length - 1) {
      commitBlockSurgical(i, value);
      return;
    }
    var next = state.blocks[i + 1];
    if (next.kind === 'hr') {
      state.lines = state.lines.slice(0, next.start).concat(state.lines.slice(next.end));
      state.blocks = MD.splitBlocks(state.lines);
      renderBlocks();
      markDirty();
      var ni = i;
      if (ni < state.blocks.length) editBlockByIdx(ni, 'end');
      return;
    }
    if (value.replace(/[\s\n]/g, '') === '') {
      // 当前块为空：删除它，光标进入下一块开头
      state.lines = state.lines.slice(0, b.start).concat(state.lines.slice(b.end));
      state.blocks = MD.splitBlocks(state.lines);
      renderBlocks();
      markDirty();
      if (i < state.blocks.length) editBlockByIdx(i, 'start');
      return;
    }
    var sameGroup = (b.kind === next.kind) ||
      ((b.kind === 'para' || b.kind === 'heading') && (next.kind === 'para' || next.kind === 'heading'));
    if (!sameGroup) {
      commitBlockSurgical(i, value);
      if (i + 1 < state.blocks.length) editBlockByIdx(i + 1, 'start');
      return;
    }
    var curLines = value.split('\n');
    var nextRaw = state.lines.slice(next.start, next.end);
    var merged = curLines.concat(nextRaw);
    var caretAt = value.length;
    if (b.kind === 'para' || b.kind === 'heading') {
      merged[curLines.length - 1] = curLines[curLines.length - 1] + ' ' + nextRaw[0];
      merged.splice(curLines.length, 1);
      caretAt += 1;
    }
    state.lines = state.lines.slice(0, b.start)
      .concat(merged, state.lines.slice(next.end));
    state.blocks = MD.splitBlocks(state.lines);
    renderBlocks();
    markDirty();
    if (i < state.blocks.length) editBlockByIdx(i, caretAt);
  }

  // 方向键越界：提交当前块后跳转到相邻块
  function navigateTo(i, value, dir, caretMode) {
    commitBlockSurgical(i, value);
    var target = i + dir;
    if (target >= 0 && target < state.blocks.length) {
      editBlockByIdx(target, caretMode);
    } else if (dir === 1 && target === state.blocks.length) {
      // 末尾继续向下：新建空段
      var endPos = state.lines.length;
      insertVirtualBlock(endPos);
    }
  }

  // 虚拟空块：Enter 后插入的连续输入位置（无占位提示，样式与段落一致）
  function insertVirtualBlock(pos) {
    commitActiveBlock();
    var box = $('wysiwyg');
    var div = document.createElement('div');
    div.className = 'blk blk-para';
    var ta = document.createElement('textarea');
    ta.className = 'blk-editor';
    div.appendChild(ta);

    var before = null;
    for (var k = 0; k < state.blocks.length; k++) {
      if (state.blocks[k].start >= pos) { before = box.children[k]; break; }
    }
    if (before) box.insertBefore(div, before); else box.appendChild(div);
    state.virtual = { div: div, pos: pos };

    autosize(ta);
    ta.focus();
    ta.addEventListener('keydown', function (ev) {
      if (ev.isComposing) return;
      var handled = false;
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        var np = commitVirtual(pos, ta.value);
        insertVirtualBlock(np);
        handled = true;
      } else if (ev.key === 'ArrowUp' && ta.selectionStart === 0) {
        ev.preventDefault();
        var pIdx = prevBlockIdxAt(pos);
        commitVirtual(pos, ta.value);
        if (pIdx >= 0) editBlockByIdx(pIdx, 'end');
        handled = true;
      } else if (ev.key === 'ArrowLeft' && ta.selectionStart === 0) {
        ev.preventDefault();
        var plIdx = prevBlockIdxAt(pos);
        commitVirtual(pos, ta.value);
        if (plIdx >= 0) editBlockByIdx(plIdx, 'end');
        handled = true;
      } else if (ev.key === 'ArrowDown' && ta.selectionEnd === ta.value.length) {
        ev.preventDefault();
        var nIdx = nextBlockIdxAt(pos);
        commitVirtual(pos, ta.value);
        if (nIdx >= 0) editBlockByIdx(nIdx, 'start');
        handled = true;
      } else if (ev.key === 'ArrowRight' && ta.selectionEnd === ta.value.length) {
        ev.preventDefault();
        var nrIdx = nextBlockIdxAt(pos);
        commitVirtual(pos, ta.value);
        if (nrIdx >= 0) editBlockByIdx(nrIdx, 'start');
        handled = true;
      } else if (ev.key === 'Escape') {
        commitVirtual(pos, ta.value);
        handled = true;
      }
      if (handled) autosize(ta);
    });
    ta.addEventListener('input', function () { autosize(ta); markDirty(); });
    ta.addEventListener('blur', function () {
      setTimeout(function () { commitVirtual(pos, ta.value); }, 150);
    });
  }

  function prevBlockIdxAt(pos) {
    var idx = -1;
    for (var k = 0; k < state.blocks.length; k++) {
      if (state.blocks[k].end <= pos) idx = k; else break;
    }
    return idx;
  }
  function nextBlockIdxAt(pos) {
    for (var k = 0; k < state.blocks.length; k++) {
      if (state.blocks[k].start >= pos) return k;
    }
    return -1;
  }

  function commitVirtual(pos, text) {
    if (!state.virtual || state.virtual.pos !== pos) return pos + 1;
    var el = state.virtual.div;
    state.virtual = null;
    var t = text || '';
    var lines = t.split('\n');
    var nextPos = pos + 1;
    if (t.replace(/[\s\n]/g, '') !== '') {
      while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
      var needSep = false;
      if (pos > 0 && pos <= state.lines.length) {
        var prev = state.lines[pos - 1];
        needSep = (prev !== undefined && prev.trim() !== '');
      }
      if (pos === state.lines.length && state.lines.length > 0 && state.lines[pos - 1].trim() !== '') {
        needSep = true;
      }
      if (needSep) {
        // 列表/引用续行不需要空行（Typora 语义：Enter 续写列表项）
        var prevLine = pos > 0 ? state.lines[pos - 1] : '';
        var isListLike = /^\s*([-*+]|\d+\.)\s+/.test(prevLine) || /^>\s?/.test(prevLine);
        var firstIsListLike = /^\s*([-*+]|\d+\.)\s+/.test(lines[0]) || /^>\s?/.test(lines[0]);
        if (isListLike && firstIsListLike) needSep = false;
      }
      var newLines = needSep ? [''].concat(lines) : lines;
      var args = [pos, 0].concat(newLines);
      Array.prototype.splice.apply(state.lines, args);
      nextPos = pos + newLines.length;
      state.blocks = MD.splitBlocks(state.lines);
      // 原位更新：移除虚拟 div 后，DOM 与 blocks 重新一一对应
      var box = $('wysiwyg');
      if (el && el.parentNode === box) box.removeChild(el);
      if (box.children.length === state.blocks.length && state.blocks.length > 0) {
        for (var k = 0; k < state.blocks.length; k++) {
          if (state.blocks[k].start <= pos && pos < state.blocks[k].end) {
            var div = box.children[k];
            div.className = blockClass(state.blocks[k]);
            div.dataset.start = state.blocks[k].start;
            div.innerHTML = MD.renderBlock(state.lines.slice(state.blocks[k].start, state.blocks[k].end), state.blocks[k].kind);
            break;
          }
        }
      } else {
        renderBlocks();
      }
      markDirty();
    } else {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      if (state.blocks.length === 0 && state.lines.join('').trim() === '') {
        renderBlocks(); // 空文档提示
      }
    }
    return nextPos;
  }

  function commitActiveBlock() {
    if (state.editingIdx >= 0) {
      var div = $('wysiwyg').children[state.editingIdx];
      var ta = div ? div.querySelector('textarea') : null;
      if (ta) commitBlockSurgical(state.editingIdx, ta.value);
    }
    if (state.virtual) {
      var vta = state.virtual.div.querySelector('textarea');
      if (vta) commitVirtual(state.virtual.pos, vta.value);
    }
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  /* ================= 认证 ================= */
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

  /* ================= 目录树 ================= */
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

  /* ================= 打开 / 保存 ================= */
  function openFile(path, name) {
    commitActiveBlock();
    if (state.dirty && state.currentPath) {
      if (!window.confirm('当前笔记有未保存的修改，确定放弃并切换吗？')) return;
    }
    api('/file?path=' + encodeURIComponent(path)).then(function (data) {
      state.currentPath = path;
      state.currentName = name || path;
      $('current-file').textContent = path;
      state.dirty = false;
      updateSaveStatus();
      if (state.mode === 'source') {
        $('src-editor').value = data.content || '';
        setDocument(data.content || '');
      } else {
        setDocument(data.content || '');
        renderBlocks();
      }
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

  /* ================= 新建 / 重命名 / 删除 ================= */
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
          setDocument('');
          $('src-editor').value = '';
          if (state.mode === 'preview') renderBlocks();
          $('current-file').textContent = '未选择笔记';
          state.dirty = false;
          updateSaveStatus();
        }
        loadTree();
        toast('已删除');
      })
      .catch(function (err) { toast(err.message); });
  }

  /* ================= 右键菜单 ================= */
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

  /* ================= 事件绑定与初始化 ================= */
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

    // 预览容器：按下时先提交上一个编辑，再进入目标块（避免重渲染导致点击落空）
    $('wysiwyg').addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'TEXTAREA') return;
      var blk = e.target.closest ? e.target.closest('.blk') : null;
      var start = -1;
      if (blk) {
        if (e.target.closest('a') || e.target.closest('img')) return;
        start = parseInt(blk.dataset.start, 10);
      }
      commitActiveBlock();
      if (!isNaN(start) && start >= 0) {
        setTimeout(function () { editBlockByStart(start, null, e); }, 0);
      }
    });
    // 点击空白处（文档末尾）→ 新建空段
    $('wysiwyg').addEventListener('click', function (e) {
      if (e.target.tagName === 'TEXTAREA') return;
      if (e.target === $('wysiwyg') ||
          (e.target.classList && e.target.classList.contains('blk-empty'))) {
        commitActiveBlock();
        insertVirtualBlock(state.lines.length);
      }
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

  // 按起始行号定位块并进入编辑
  function editBlockByStart(startLine, caretMode, clickEvent) {
    for (var k = 0; k < state.blocks.length; k++) {
      if (state.blocks[k].start <= startLine && startLine < state.blocks[k].end) {
        editBlockByIdx(k, caretMode, clickEvent);
        return;
      }
    }
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
