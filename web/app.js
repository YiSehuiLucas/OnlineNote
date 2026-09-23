/**
 * OnlineNote 前端逻辑（v3.0，零构建）
 * 编辑器：**源码文本行 = 唯一模型**，原地渲染（类 Typora）。
 *   输入即渲染：语法标记（#、-、1.、`、```、---）始终保留在 DOM 文本里，
 *   CSS 控制隐藏/显示（编辑当前行时显示），DOM 文本与源码文本一一对应。
 * 普通打字只重渲染当前块；仅结构变化（回车/退格合并/粘贴多行/类型转换）才整文档重渲染。
 * Ctrl+Z 撤销、Ctrl+S 保存、夜间主题、SVG 目录树。
 * 支持语法：标题 / 无序列表 / 有序列表 / 分隔线 / 行内代码 / 围栏代码块。
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
    lines: [''],           // 源码文本行（唯一模型，与磁盘文件一致）
    blocks: [],            // 由 lines 解析出的块（渲染视图）
    undo: [],              // [{text, lines, caret:{line,off}}]
    composing: false,
    editingEl: null        // 当前显示语法标记的块元素
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
    sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>')
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

  /* ================= 编辑器核心（原地渲染） ================= */

  // 标记的 HTML：空格渲染为 &nbsp;，避免 Chrome 在标记末尾输入时吞并尾随空格
  function markerHTML(marker) {
    return MD.escapeHtml(marker).replace(/ /g, '&nbsp;');
  }

  // 块元素内部 HTML（标记字符 + 转义文本；textContent 恒等于块源码文本）
  function blockInnerHTML(b) {
    switch (b.type) {
      case 'para':
        return MD.renderInline(b.text) || '<br>';
      case 'heading':
      case 'li':
        return '<span class="md-marker">' + markerHTML(b.marker) + '</span><span class="md-body">' + MD.renderInline(b.body) + '</span>';
      case 'hr':
        return MD.escapeHtml(b.text);
      case 'code': {
        // 代码块 DOM 只含代码内容（围栏只存在于模型中）：
        // 单一文本节点 + pre 环境，Chrome 不会吞并换行/空格；
        // 末尾用零宽字符占位：空行/围栏后都需要一个可停留的光标位置
        var inner = codeInner(b);
        var zw = (inner === '' || inner.charAt(inner.length - 1) === '\n' || codeHasClose(b)) ? '\u200b' : '';
        return '<pre><code>' + MD.escapeHtml(inner) + zw + '</code></pre>';
      }
    }
    return '';
  }

  // 代码块内部行（去掉首尾围栏）
  function codeInner(b) {
    var parts = b.text.split('\n');
    return (codeHasClose(b) ? parts.slice(1, -1) : parts.slice(1)).join('\n');
  }
  function codeHasClose(b) {
    var parts = b.text.split('\n');
    return parts.length > 1 && /^```/.test(parts[parts.length - 1]);
  }
  // 代码块模型偏移 ↔ DOM 偏移（DOM 不含围栏，差一个首行长度）
  function codeContentStart(b) {
    return b.text.split('\n')[0].length + 1;
  }
  function modelLocalFor(b, el, domLocal) {
    if (!b || b.type !== 'code') return domLocal;
    // 零宽占位符不计入模型；原生编辑后以当前 DOM 文本为准
    var innerLen = el.textContent.replace(/\u200b/g, '').length;
    if (domLocal <= innerLen) return codeContentStart(b) + domLocal;
    // 闭围栏代码块：末尾零宽字符之后 = 围栏之后（模型末尾）
    return codeHasClose(b) ? b.text.length : codeContentStart(b) + innerLen;
  }
  function domLocalFor(b, modelLocal) {
    if (!b || b.type !== 'code') return modelLocal;
    var inner = codeInner(b);
    var start = codeContentStart(b);
    if (modelLocal >= start + inner.length) {
      // 目标在代码末尾之外：闭围栏 → 零宽字符后（围栏后）；末尾空行 → 零宽字符后；否则代码末尾
      if (modelLocal === b.text.length && codeHasClose(b)) return inner.length + 1;
      if (inner === '' || inner.charAt(inner.length - 1) === '\n') return inner.length + 1;
      return inner.length;
    }
    return Math.max(0, modelLocal - start);
  }

  // 代码块"代码内容末尾"的块内偏移（不含关围栏；未闭合则为全文末尾）
  function codeContentEnd(b) {
    var parts = b.text.split('\n');
    var lastIsFence = parts.length > 1 && /^```/.test(parts[parts.length - 1]);
    if (!lastIsFence) return b.text.length;
    return b.text.length - 1 - parts[parts.length - 1].length;
  }

  // 代码块"代码内容末尾"的行信息（光标定位用）
  function codeContentEndInfo(b) {
    var parts = b.text.split('\n');
    var lastIsFence = parts.length > 1 && /^```/.test(parts[parts.length - 1]);
    var n = lastIsFence ? parts.length - 2 : parts.length - 1;
    return { line: b.start + n, off: (parts[n] || '').length };
  }

  // 创建块元素
  function blockEl(b, i) {
    var el;
    if (b.type === 'para') el = document.createElement('p');
    else if (b.type === 'heading') el = document.createElement('h' + b.level);
    else el = document.createElement('div');
    el.innerHTML = blockInnerHTML(b);
    el.className = 'md-blk ' + (b.type === 'li' ? (b.ordered ? 'md-oli' : 'md-li') : 'md-' + b.type);
    el.dataset.i = i;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'false');
    return el;
  }

  // 末尾虚拟空段随文档状态增减（行内更新后也要保持一致）
  function ensureVirtual() {
    var box = $('wysiwyg');
    var last = state.lines[state.lines.length - 1];
    var hasV = box.lastChild && box.lastChild.classList && box.lastChild.classList.contains('md-virtual');
    if (last && !/^\s*$/.test(last)) {
      if (!hasV) {
        var v = document.createElement('p');
        v.className = 'md-blk md-para md-virtual';
        v.innerHTML = '<br>';
        v.setAttribute('contenteditable', 'true');
        v.setAttribute('spellcheck', 'false');
        box.appendChild(v);
      }
    } else if (hasV) {
      box.removeChild(box.lastChild);
    }
  }

  // 整文档渲染（块索引 = DOM 子元素索引，一一对应）
  function renderDocument() {
    var box = $('wysiwyg');
    var st = box.scrollTop;
    state.blocks = MD.parseBlocks(state.lines);
    box.innerHTML = '';
    state.blocks.forEach(function (b, i) { box.appendChild(blockEl(b, i)); });
    ensureVirtual();
    box.classList.toggle('is-empty', state.lines.length === 1 && state.lines[0] === '');
    box.scrollTop = st;
    state.editingEl = null;
  }

  /* ---------- 光标工具（纯文本偏移，<br> 记 0） ---------- */

  function closestBlock(node) {
    var n = node;
    while (n) {
      if (n.classList && n.classList.contains('md-blk')) return n;
      n = n.parentNode;
    }
    return null;
  }

  function textLenOf(node) {
    if (node.nodeType === 3) return node.textContent.length;
    if (node.tagName === 'BR') return 0;
    var len = 0;
    for (var i = 0; i < node.childNodes.length; i++) len += textLenOf(node.childNodes[i]);
    return len;
  }

  // root 内 node/off → root 的纯文本偏移
  function textOffsetIn(root, node, off) {
    var pos = 0, found = false;
    (function walk(el) {
      for (var i = 0; i < el.childNodes.length && !found; i++) {
        var c = el.childNodes[i];
        if (c === node) {
          if (c.nodeType === 3) pos += off;
          else {
            for (var j = 0; j < off && j < c.childNodes.length; j++) pos += textLenOf(c.childNodes[j]);
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

  // root 内纯文本偏移 off 处放置光标
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
    if (placed) range.collapse(true);
    else { range.selectNodeContents(root); range.collapse(false); }
    sel.addRange(range);
  }

  // 当前选区（锚点）→ { el, local }（local 为模型偏移：代码块已加上围栏长度）
  function getCaret() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var node = sel.anchorNode;
    if (!node) return null;
    var el = closestBlock(node.nodeType === 1 ? node : node.parentNode);
    if (!el) return null;
    var local = textOffsetIn(el, node, sel.anchorOffset);
    var bi = el.dataset.i;
    if (bi !== undefined) {
      var b = state.blocks[parseInt(bi, 10)];
      local = modelLocalFor(b, el, local);
    }
    return { el: el, local: local };
  }

  // 选区焦点端 → { el, local }（选区删除用）
  function getCaretEnd() {
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || !sel.rangeCount) return null;
    var node = sel.focusNode;
    if (!node) return null;
    var el = closestBlock(node.nodeType === 1 ? node : node.parentNode);
    if (!el) return null;
    var local = textOffsetIn(el, node, sel.focusOffset);
    var bi = el.dataset.i;
    if (bi !== undefined) {
      var b = state.blocks[parseInt(bi, 10)];
      local = modelLocalFor(b, el, local);
    }
    return { el: el, local: local };
  }

  // 块内偏移 → 行号 + 行内偏移
  function lineInfoInBlock(b, local) {
    var before = b.text.slice(0, local);
    var nl = before.split('\n').length - 1;
    return { line: b.start + nl, off: local - before.lastIndexOf('\n') - 1 };
  }

  // 当前光标 → {line, off}（撤销快照用）
  function caretLineInfo() {
    var c = getCaret();
    if (!c) return { line: 0, off: 0 };
    var bi = c.el.dataset.i;
    if (bi === undefined) return { line: state.lines.length, off: 0 };   // 虚拟段
    var b = state.blocks[parseInt(bi, 10)];
    var li = lineInfoInBlock(b, c.local);
    li.off = Math.min(li.off, (state.lines[li.line] || '').length);
    return li;
  }

  // 行信息 → 放置光标（渲染后定位；代码块做模型→DOM 偏移映射）
  function placeCaretAt(info) {
    var box = $('wysiwyg');
    var line = Math.max(0, Math.min(info.line, state.lines.length - 1));
    var b = null, bi = -1;
    for (var i = 0; i < state.blocks.length; i++) {
      if (state.blocks[i].start <= line && line <= state.blocks[i].end) { b = state.blocks[i]; bi = i; break; }
    }
    var el, local, mapB = b;
    if (!b) {
      el = box.lastChild;
      if (!el) return;
      var lbi = el.dataset.i;
      if (lbi !== undefined) {
        mapB = state.blocks[parseInt(lbi, 10)];
        local = mapB.type === 'code' ? codeContentEnd(mapB) : textLenOf(el);
      } else {
        local = 0;
      }
    } else {
      el = box.children[bi];
      var off = 0;
      for (var k = b.start; k < line; k++) off += state.lines[k].length + 1;
      local = off + Math.min(info.off, (state.lines[line] || '').length);
    }
    placeCaretIn(el, domLocalFor(mapB, local));
    el.focus();
    refreshEditing();
  }

  // 当前光标所在块显示语法标记（其余隐藏）
  function refreshEditing() {
    var c = getCaret();
    var el = c ? c.el : null;
    if (el === state.editingEl) return;
    if (state.editingEl) state.editingEl.classList.remove('md-editing');
    state.editingEl = el;
    if (el) el.classList.add('md-editing');
  }

  /* ---------- 撤销 ---------- */
  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      updateSaveStatus();
    }
  }

  function pushUndo() {
    var text = state.lines.join('\n');
    var top = state.undo[state.undo.length - 1];
    if (top && top.text === text) return;
    state.undo.push({ text: text, lines: state.lines.slice(), caret: caretLineInfo() });
    if (state.undo.length > 100) state.undo.shift();
  }

  function undo() {
    var item = state.undo.pop();
    if (!item) return;
    if (state.lines.join('\n') === item.text && state.undo.length) {
      item = state.undo.pop();
      if (!item) return;
    }
    state.lines = item.lines;
    renderDocument();
    placeCaretAt(item.caret || { line: 0, off: 0 });
    markDirty();
  }

  /* ---------- 输入：同步模型 + 按需渲染 ---------- */

  function sameBlocks(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i], y = b[i];
      if (x.type !== y.type || x.start !== y.start || x.end !== y.end) return false;
      if ((x.level || 0) !== (y.level || 0)) return false;
      if (!!x.ordered !== !!y.ordered) return false;
    }
    return true;
  }

  function handleInput() {
    var c = getCaret();
    if (!c) { renderDocument(); return; }          // 光标漂出块外 → 恢复渲染态
    var bi = c.el.dataset.i;

    // —— 虚拟尾段：输入内容变成真实新行 ——
    if (bi === undefined) {
      var vtext = c.el.textContent.replace(/\u00a0/g, ' ');
      if (!vtext) return;
      state.lines.push(vtext);
      renderDocument();
      placeCaretAt({ line: state.lines.length - 1, off: vtext.length });
      markDirty();
      pushUndo();
      return;
    }

    var idx = parseInt(bi, 10);
    var old = state.blocks[idx];
    if (!old) return;
    // 还原块源码文本：普通块 = DOM 文本（&nbsp; → 空格）；
    // 代码块 = 首行围栏 + DOM 代码内容 +（原有关围栏）
    var text;
    if (old.type === 'code') {
      var parts0 = old.text.split('\n');
      var hadClose = parts0.length > 1 && /^```/.test(parts0[parts0.length - 1]);
      text = state.lines[old.start] + '\n' + c.el.textContent.replace(/\u200b/g, '') + (hadClose ? '\n```' : '');
    } else {
      text = c.el.textContent.replace(/\u00a0/g, ' ');
    }
    if (text === old.text) return;                 // 内容未变（如光标移动）

    // 同步模型：块文本 → 行数组
    state.lines.splice(old.start, old.end - old.start + 1);
    var newLines = text.split('\n');
    for (var k = 0; k < newLines.length; k++) state.lines.splice(old.start + k, 0, newLines[k]);

    // 光标在块文本中的位置 → 行号 + 行内偏移
    var before = text.slice(0, c.local);
    var lineIdx = old.start + before.split('\n').length - 1;
    var lineOff = c.local - before.lastIndexOf('\n') - 1;

    // 结构是否变化（类型/层级/列表序号样式/范围）
    var newBlocks = MD.parseBlocks(state.lines);
    var changed = !sameBlocks(state.blocks, newBlocks);
    state.blocks = newBlocks;

    if (changed) {
      // 块结构变化（如补全 # / - / 1. / --- / ```）→ 整文档重渲染
      renderDocument();
      placeCaretAt({ line: lineIdx, off: Math.min(lineOff, (state.lines[lineIdx] || '').length) });
    } else {
      // 仅行内变化 → 原位更新当前块，光标按块内偏移恢复
      var el2 = $('wysiwyg').children[idx];
      el2.innerHTML = blockInnerHTML(state.blocks[idx]);
      ensureVirtual();
      placeCaretIn(el2, domLocalFor(state.blocks[idx], c.local));
      el2.focus();
      refreshEditing();
    }
    markDirty();
    pushUndo();
  }

  /* ---------- 结构操作 ---------- */

  function nextMarker(b) {
    if (!b.ordered) return b.marker;
    var num = parseInt(b.marker, 10);
    if (isNaN(num)) return b.marker;
    var dot = b.marker.indexOf('.');
    return (num + 1) + b.marker.slice(dot);
  }

  // 上一块的末尾光标位置
  function prevEndInfo(idx) {
    var b = state.blocks[idx];
    if (!b) return { line: 0, off: 0 };
    if (b.type === 'code') return codeContentEndInfo(b);
    return { line: b.start, off: b.text.length };
  }

  // 删除选区（跨块按行处理），返回折叠后的 {line, off}
  function deleteSelection() {
    var a = caretLineInfo();
    var f = getCaretEnd();
    if (!f) return null;
    var fi = f.el.dataset.i;
    var fInfo = fi === undefined
      ? { line: state.lines.length, off: 0 }
      : (function () {
          var fb = state.blocks[parseInt(fi, 10)];
          var li = lineInfoInBlock(fb, f.local);
          li.off = Math.min(li.off, (state.lines[li.line] || '').length);
          return li;
        })();
    if (a.line === fInfo.line && a.off === fInfo.off) return a;    // 无选区
    var lo = (a.line < fInfo.line || (a.line === fInfo.line && a.off <= fInfo.off)) ? a : fInfo;
    var hi = lo === a ? fInfo : a;
    var l1 = lo.line, o1 = lo.off;
    var l2 = Math.min(hi.line, state.lines.length - 1);
    var o2 = Math.min(hi.off, (state.lines[l2] || '').length);
    if (l1 > l2) { var t = l1; l1 = l2; l2 = t; t = o1; o1 = o2; o2 = t; }
    if (l1 === l2) {
      state.lines[l1] = state.lines[l1].slice(0, o1) + state.lines[l1].slice(o2);
    } else {
      state.lines[l1] = state.lines[l1].slice(0, o1) + state.lines[l2].slice(o2);
      state.lines.splice(l1 + 1, l2 - l1);
    }
    return { line: l1, off: o1 };
  }

  // 回车：块内换行 / 拆块 / 退出列表
  function doEnter(c) {
    var idx = c.el.dataset.i;
    var target;

    if (idx === undefined) {                       // 虚拟尾段 → 换出新行
      state.lines.push('');
      target = { line: state.lines.length - 1, off: 0 };
    } else {
      var b = state.blocks[parseInt(idx, 10)];
      var start = b.start;
      if (b.type === 'code') {
        // 代码块内回车：插入真实换行
        var before = b.text.slice(0, c.local);
        var nl = before.split('\n').length - 1;
        var ln = start + nl;
        var lineOff = c.local - before.lastIndexOf('\n') - 1;
        var line = state.lines[ln];
        state.lines.splice(ln, 1, line.slice(0, lineOff), line.slice(lineOff));
        target = { line: ln + 1, off: 0 };
      } else if (b.type === 'hr') {
        state.lines.splice(start + 1, 0, '');
        target = { line: start + 1, off: 0 };
      } else if (b.type === 'heading') {
        if (c.local <= b.marker.length) {          // 标记内回车 → 上方插入空段
          state.lines.splice(start, 0, '');
          target = { line: start, off: 0 };
        } else {                                   // 正文回车 → 拆出段落
          state.lines.splice(start, 1, b.text.slice(0, c.local), b.text.slice(c.local));
          target = { line: start + 1, off: 0 };
        }
      } else if (b.type === 'li') {
        if (b.body === '' && c.local >= b.marker.length) {
          // 空列表项回车 → 退出列表
          state.lines.splice(start, 1, '');
          target = { line: start, off: 0 };
        } else if (c.local <= b.marker.length) {
          // 标记处回车 → 上方插入同型空项
          state.lines.splice(start, 0, b.marker);
          target = { line: start, off: b.marker.length };
        } else {
          // 正文回车 → 拆分列表项（有序列表序号 +1）
          var mk = nextMarker(b);
          state.lines.splice(start, 1, b.text.slice(0, c.local), mk + b.text.slice(c.local));
          target = { line: start + 1, off: mk.length };
        }
      } else {
        // 段落：拆行
        state.lines.splice(start, 1, b.text.slice(0, c.local), b.text.slice(c.local));
        target = { line: start + 1, off: 0 };
      }
    }
    renderDocument();
    placeCaretAt(target);
    markDirty();
    pushUndo();
  }

  // 退格（块首 / 标记处 / 代码块首）
  function doBackspace(c) {
    var idx = c.el.dataset.i;
    if (idx === undefined) return;
    var b = state.blocks[parseInt(idx, 10)];
    var start = b.start;
    var target;

    if (b.type === 'code') {
      if (c.local > codeContentStart(b)) return;   // 块内退格交给浏览器
      // 代码块首退格 → 去掉围栏，整块变段落
      var parts = b.text.split('\n');
      var inner = parts.length > 1 && /^```/.test(parts[parts.length - 1]) ? parts.slice(1, -1) : parts.slice(1);
      state.lines.splice(start, b.end - start + 1);
      if (inner.length === 0) inner = [''];
      for (var k = 0; k < inner.length; k++) state.lines.splice(start + k, 0, inner[k]);
      target = { line: start, off: 0 };
    } else if ((b.type === 'heading' || b.type === 'li') && c.local === b.marker.length) {
      // 标记后退格 → 去掉标记，变段落
      state.lines.splice(start, 1, b.body || '');
      target = { line: start, off: 0 };
    } else if (c.local === 0) {
      if (start === 0) return;                     // 首块无操作
      if (b.type === 'hr') {
        // 删除分隔线，光标落到上一块末尾
        state.lines.splice(start, 1);
        target = prevEndInfo(idx - 1);
      } else if (b.type === 'para' && /^\s*$/.test(b.text)) {
        // 删除空行
        state.lines.splice(start, 1);
        target = prevEndInfo(idx - 1);
      } else {
        var prev = state.blocks[idx - 1];
        var curBody = (b.type === 'heading' || b.type === 'li') ? b.body : b.text;
        if (prev.type === 'code') {
          target = codeContentEndInfo(prev);
        } else if (prev.type === 'hr') {
          target = { line: prev.start, off: prev.text.length };
        } else {
          // 并入上一行（当前行是标题/列表时剥掉标记）
          var pbody = (prev.type === 'heading' || prev.type === 'li') ? prev.body : prev.text;
          var sep = pbody ? ' ' : '';
          state.lines[prev.start] = prev.text + sep + curBody;
          state.lines.splice(start, 1);
          target = { line: prev.start, off: prev.text.length + sep.length + curBody.length };
        }
      }
    } else {
      return;                                      // 块内退格交给浏览器
    }
    renderDocument();
    placeCaretAt(target);
    markDirty();
    pushUndo();
  }

  // 前删（块尾合并 / 代码内容末尾去围栏）
  function doDelete(c) {
    var idx = c.el.dataset.i;
    if (idx === undefined) return;
    var b = state.blocks[parseInt(idx, 10)];
    var start = b.start;
    var contentEnd = b.type === 'code' ? codeContentEnd(b) : b.text.length;
    if (c.local < contentEnd) return;              // 块内删除交给浏览器
    var target;

    if (b.type === 'code') {
      // 代码内容末尾 Delete → 去掉围栏，整块变段落
      var parts = b.text.split('\n');
      var inner = parts.length > 1 && /^```/.test(parts[parts.length - 1]) ? parts.slice(1, -1) : parts.slice(1);
      state.lines.splice(start, b.end - start + 1);
      if (inner.length === 0) inner = [''];
      for (var k = 0; k < inner.length; k++) state.lines.splice(start + k, 0, inner[k]);
      var lastLine = start + inner.length - 1;
      target = { line: lastLine, off: (state.lines[lastLine] || '').length };
    } else if (b.type === 'hr') {
      // 分隔线末尾 Delete → 删除分隔线
      state.lines.splice(start, 1);
      target = { line: start, off: 0 };
    } else {
      if (idx >= state.blocks.length - 1) return;  // 文末无操作
      var next = state.blocks[idx + 1];
      if (next.type === 'hr') {
        state.lines.splice(next.start, 1);
        target = { line: start, off: b.text.length };
      } else if (next.type === 'code') {
        return;                                    // 代码块边界不合并
      } else {
        // 下一行并入当前行
        var nbody = (next.type === 'heading' || next.type === 'li') ? next.body : next.text;
        var cur = (b.type === 'heading' || b.type === 'li') ? b.body : b.text;
        var sep = cur ? ' ' : '';
        state.lines[start] = b.text + sep + nbody;
        state.lines.splice(next.start, 1);
        target = { line: start, off: b.text.length + sep.length + nbody.length };
      }
    }
    renderDocument();
    placeCaretAt(target);
    markDirty();
    pushUndo();
  }

  // 粘贴（多行拆行）
  function doPaste(c, text) {
    text = String(text).replace(/\r\n?/g, '\n');
    var bi = c.el.dataset.i;
    var target;

    if (bi === undefined) {                        // 虚拟段
      var vlines = text.split('\n');
      for (var k = 0; k < vlines.length; k++) state.lines.push(vlines[k]);
      target = { line: state.lines.length - 1, off: vlines[vlines.length - 1].length };
    } else {
      var b = state.blocks[parseInt(bi, 10)];
      if (b.type === 'code') {
        var nt = b.text.slice(0, c.local) + text + b.text.slice(c.local);
        var nlines = nt.split('\n');
        state.lines.splice(b.start, b.end - b.start + 1);
        for (var j = 0; j < nlines.length; j++) state.lines.splice(b.start + j, 0, nlines[j]);
        var before2 = nt.slice(0, c.local + text.length);
        target = { line: b.start + before2.split('\n').length - 1, off: before2.length - before2.lastIndexOf('\n') - 1 };
      } else {
        var l1 = b.text.slice(0, c.local), r1 = b.text.slice(c.local);
        var ps = text.split('\n');
        var newLines = [l1 + ps[0]];
        for (var m = 1; m < ps.length; m++) newLines.push(ps[m]);
        newLines[newLines.length - 1] += r1;
        state.lines.splice(b.start, b.end - b.start + 1);
        for (var n2 = 0; n2 < newLines.length; n2++) state.lines.splice(b.start + n2, 0, newLines[n2]);
        target = { line: b.start + newLines.length - 1, off: newLines[newLines.length - 1].length - r1.length };
      }
    }
    renderDocument();
    placeCaretAt(target);
    markDirty();
    pushUndo();
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
      var content = data.content || '';
      state.lines = content === '' ? [''] : content.split('\n');
      state.undo = [];
      state.dirty = false;
      updateSaveStatus();
      renderDocument();
    }).catch(function (err) { toast(err.message); });
  }

  function save() {
    if (!state.currentPath) { toast('请先选择一篇笔记'); return; }
    var text = state.lines.join('\n');
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
          state.lines = [''];
          state.undo = [];
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

    // ===== 原地渲染编辑器 =====
    var box = $('wysiwyg');

    // 普通输入：同步模型；行内变化只更新当前块，结构变化才整文档重渲染
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
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      var sel = window.getSelection();
      var collapsed = sel && sel.isCollapsed;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!collapsed) {
          var t0 = deleteSelection();
          if (t0) { renderDocument(); placeCaretAt(t0); markDirty(); pushUndo(); }
        }
        var c = getCaret();
        if (c) doEnter(c);
        return;
      }
      if (e.key === 'Backspace') {
        if (!collapsed) {
          e.preventDefault();
          var t1 = deleteSelection();
          if (t1) { renderDocument(); placeCaretAt(t1); markDirty(); pushUndo(); }
          return;
        }
        var c1 = getCaret();
        if (!c1) return;
        var bi1 = c1.el.dataset.i;
        var b1 = bi1 === undefined ? null : state.blocks[parseInt(bi1, 10)];
        var atMarker = b1 && (b1.type === 'heading' || b1.type === 'li') && c1.local === b1.marker.length;
        if (c1.local === 0 || atMarker) {
          e.preventDefault();
          doBackspace(c1);
        }
        return;
      }
      if (e.key === 'Delete') {
        if (!collapsed) {
          e.preventDefault();
          var t2 = deleteSelection();
          if (t2) { renderDocument(); placeCaretAt(t2); markDirty(); pushUndo(); }
          return;
        }
        var c2 = getCaret();
        if (!c2) return;
        var bi2 = c2.el.dataset.i;
        var b2 = bi2 === undefined ? null : state.blocks[parseInt(bi2, 10)];
        if (!b2) return;
        var end2 = b2.type === 'code' ? codeContentEnd(b2) : b2.text.length;
        if (c2.local >= end2) {
          e.preventDefault();
          doDelete(c2);
        }
        return;
      }
    });

    box.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (!text) return;
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        var t = deleteSelection();
        if (t) { renderDocument(); placeCaretAt(t); }
      }
      var c = getCaret();
      if (c) doPaste(c, text);
    });

    // 点击块间空白：光标落到末尾块（虚拟空段）
    box.addEventListener('mousedown', function (e) {
      if (e.target !== box) return;
      e.preventDefault();
      var last = box.lastChild;
      if (!last) return;
      var local = 0;
      var bi = last.dataset.i;
      var lb = null;
      if (bi !== undefined) {
        lb = state.blocks[parseInt(bi, 10)];
        local = lb && lb.type === 'code' ? codeContentEnd(lb) : textLenOf(last);
      }
      placeCaretIn(last, domLocalFor(lb, local));
      last.focus();
      refreshEditing();
    });

    // 光标所在块显示语法标记；焦点离开编辑器则全部隐藏
    document.addEventListener('selectionchange', refreshEditing);
    box.addEventListener('focusout', function (e) {
      if (state.editingEl && (!e.relatedTarget || !box.contains(e.relatedTarget))) {
        state.editingEl.classList.remove('md-editing');
        state.editingEl = null;
      }
    });

    // 快捷键
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        save();
      }
    });
    document.addEventListener('click', hideCtxMenu);
  }

  function init() {
    $('mode-hint').textContent = '原地编辑 · 输入即渲染（Ctrl+Z 撤销 · Ctrl+S 保存）';
    renderDocument();
    updateThemeBtn();
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
