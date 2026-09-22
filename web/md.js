/**
 * 轻量 Markdown 引擎 v2（AST 架构，参照 goldmark 设计）
 *
 * 核心思想：**AST 是唯一事实来源**——语法标记（#、**、- 等）不存在于模型中：
 *   标题 = {kind:'heading', level, children}，加粗 = {kind:'strong', children}，
 *   列表项 = {kind:'listitem', children}（标记是隐式的）。
 * 渲染（AST→HTML）与序列化（AST→Markdown 文本）都从 AST 生成；
 * DOM 文本与 AST 文本一一对应（无隐藏标记），编辑时的光标定位即纯文本偏移。
 *
 * 块级节点：document / heading / paragraph / code / list(listitem) / quote / hr
 * 行内节点：text / strong / em / del / codespan / link / image / softbreak
 */
(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isBlank(l) { return /^\s*$/.test(l); }

  /* ================= 行内 AST ================= */

  // 文本 → 行内节点序列（一层解析：strong/em/del/codespan/link/image/text）
  function parseInlines(text) {
    text = String(text);
    var nodes = [];
    var re = /(`[^`]+`|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|~~[^~]+~~)/g;
    var last = 0, m;
    function pushText(t) { if (t) nodes.push({ kind: 'text', lit: t }); }
    while ((m = re.exec(text))) {
      pushText(text.slice(last, m.index));
      var s = m[0];
      if (s[0] === '`' && s.length > 2) {
        nodes.push({ kind: 'codespan', lit: s.slice(1, -1) });
      } else if (s.slice(0, 2) === '~~' && s.length > 4) {
        nodes.push({ kind: 'del', children: parseInlines(s.slice(2, -2)) });
      } else if ((s.slice(0, 2) === '**' || s.slice(0, 2) === '__') && s.length > 4) {
        nodes.push({ kind: 'strong', children: parseInlines(s.slice(2, -2)) });
      } else if (s[0] === '!' && s[1] === '[') {
        var im = s.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        if (im) nodes.push({ kind: 'image', href: im[2], alt: im[1] });
        else pushText(s);
      } else if (s[0] === '[') {
        var lm = s.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (lm) nodes.push({ kind: 'link', href: lm[2], children: parseInlines(lm[1]) });
        else pushText(s);
      } else if (s[0] === '*' && s.length > 2) {
        nodes.push({ kind: 'em', children: parseInlines(s.slice(1, -1)) });
      } else {
        pushText(s);
      }
      last = m.index + s.length;
    }
    pushText(text.slice(last));
    return nodes;
  }

  // 行内节点序列 → Markdown 文本
  function serializeInlines(nodes) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      switch (n.kind) {
        case 'text': out += n.lit; break;
        case 'softbreak': out += '\n'; break;
        case 'strong': out += '**' + serializeInlines(n.children) + '**'; break;
        case 'em': out += '*' + serializeInlines(n.children) + '*'; break;
        case 'del': out += '~~' + serializeInlines(n.children) + '~~'; break;
        case 'codespan': out += '`' + n.lit + '`'; break;
        case 'link': out += '[' + serializeInlines(n.children) + '](' + n.href + ')'; break;
        case 'image': out += '![' + n.alt + '](' + n.href + ')'; break;
      }
    }
    return out;
  }

  // 行内节点序列 → HTML（softbreak 渲染为 <br>：所见即所得编辑态的行内换行）
  function renderInlines(nodes) {
    var out = '';
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      switch (n.kind) {
        case 'text': out += escapeHtml(n.lit); break;
        case 'softbreak': out += '<br>'; break;
        case 'strong': out += '<strong>' + renderInlines(n.children) + '</strong>'; break;
        case 'em': out += '<em>' + renderInlines(n.children) + '</em>'; break;
        case 'del': out += '<del>' + renderInlines(n.children) + '</del>'; break;
        case 'codespan': out += '<code>' + escapeHtml(n.lit) + '</code>'; break;
        case 'link': out += '<a href="' + escapeHtml(n.href) + '" target="_blank" rel="noopener">' + renderInlines(n.children) + '</a>'; break;
        case 'image': out += '<img src="' + escapeHtml(n.href) + '" alt="' + escapeHtml(n.alt) + '">'; break;
      }
    }
    return out;
  }

  // 行内序列的 DOM 文本长度（softbreak/image 记 0，与 DOM 文本节点一致）
  function inlineTextLen(nodes) {
    var len = 0;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      switch (n.kind) {
        case 'text': case 'codespan': len += n.lit.length; break;
        case 'strong': case 'em': case 'del': case 'link': len += inlineTextLen(n.children); break;
      }
    }
    return len;
  }

  // 按 DOM 文本偏移切分行内序列（在格式化节点内部切分时节点一分为二）
  function splitInlinesAt(nodes, off) {
    var left = [], right = [];
    var pos = 0, cut = false;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (cut) { right.push(n); continue; }
      var len = n.kind === 'text' || n.kind === 'codespan' ? n.lit.length
        : (n.kind === 'strong' || n.kind === 'em' || n.kind === 'del' || n.kind === 'link' ? inlineTextLen(n.children) : 0);
      if (off > pos + len) { left.push(n); pos += len; continue; }
      // 切分点落在本节点内
      if (n.kind === 'text') {
        if (off > pos) left.push({ kind: 'text', lit: n.lit.slice(0, off - pos) });
        if (off < pos + len) right.push({ kind: 'text', lit: n.lit.slice(off - pos) });
      } else if (n.kind === 'codespan') {
        if (off > pos) left.push({ kind: 'codespan', lit: n.lit.slice(0, off - pos) });
        if (off < pos + len) right.push({ kind: 'codespan', lit: n.lit.slice(off - pos) });
      } else if (n.kind === 'strong' || n.kind === 'em' || n.kind === 'del' || n.kind === 'link') {
        var sp = splitInlinesAt(n.children, off - pos);
        var lc = { kind: n.kind, children: sp.left };
        if (n.kind === 'link') lc.href = n.href;
        var rc = { kind: n.kind, children: sp.right };
        if (n.kind === 'link') rc.href = n.href;
        if (sp.left.length) left.push(lc);
        if (sp.right.length) right.push(rc);
      } else {
        // softbreak/image：切分点不落在其"内部"
        left.push(n);
      }
      cut = true;
      pos += len;
    }
    return { left: left, right: right };
  }

  // 合并相邻文本节点（逐字插入/DOM 解析会产生相邻 text 节点）
  function mergeTexts(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.kind === 'text' && out.length && out[out.length - 1].kind === 'text') {
        out[out.length - 1].lit += n.lit;
      } else {
        out.push(n);
      }
    }
    return out;
  }

  // 在行内序列的 DOM 文本偏移处插入新节点
  function insertIntoInlines(nodes, off, ins) {
    var sp = splitInlinesAt(nodes, off);
    return mergeTexts(sp.left.concat(ins, sp.right));
  }

  // 检测段落行首的块级语法标记（模型外信息，仅用于转换）
  function leadingMarker(nodes) {
    if (!nodes.length || nodes[0].kind !== 'text') return null;
    var m = nodes[0].lit.match(/^(#{1,6})\s+/);
    if (m) return { type: 'heading', level: m[1].length };
    m = nodes[0].lit.match(/^([-*+]|\d+\.)\s+/);
    if (m) return { type: 'list', ordered: /\d+\./.test(m[1]) };
    m = nodes[0].lit.match(/^>\s?/);
    if (m) return { type: 'quote' };
    return null;
  }

  // 去掉行首标记文本
  function stripMarker(nodes, mk) {
    if (!nodes.length || nodes[0].kind !== 'text') return nodes;
    var m;
    if (mk.type === 'heading') m = nodes[0].lit.match(/^(#{1,6})\s+/);
    else if (mk.type === 'list') m = nodes[0].lit.match(/^([-*+]|\d+\.)\s+/);
    else m = nodes[0].lit.match(/^>\s?/);
    if (!m) return nodes;
    var rest = nodes[0].lit.slice(m[0].length);
    var out = nodes.slice(1);
    if (rest) out.unshift({ kind: 'text', lit: rest });
    return out;
  }

  // DOM 元素 → 行内节点序列（仅处理编辑器渲染出的结构；唯一子节点 <br> 视为空）
  function inlinesFromDOM(el) {
    if (el.childNodes.length === 1 && el.childNodes[0].nodeName === 'BR') return [];
    var nodes = [];
    function walk(node) {
      for (var ci = 0; ci < node.childNodes.length; ci++) {
        var c = node.childNodes[ci];
        if (c.nodeType === 3) {
          if (c.textContent) nodes.push({ kind: 'text', lit: c.textContent });
        } else {
          switch (c.tagName) {
            case 'STRONG': nodes.push({ kind: 'strong', children: inlinesFromDOM(c) }); break;
            case 'EM': nodes.push({ kind: 'em', children: inlinesFromDOM(c) }); break;
            case 'DEL': nodes.push({ kind: 'del', children: inlinesFromDOM(c) }); break;
            case 'CODE': nodes.push({ kind: 'codespan', lit: c.textContent }); break;
            case 'A': nodes.push({ kind: 'link', href: c.getAttribute('href') || '', children: inlinesFromDOM(c) }); break;
            case 'IMG': nodes.push({ kind: 'image', href: c.getAttribute('src') || '', alt: c.getAttribute('alt') || '' }); break;
            case 'BR': nodes.push({ kind: 'softbreak' }); break;
            default: {
              var inner = inlinesFromDOM(c);
              for (var k = 0; k < inner.length; k++) nodes.push(inner[k]);
              break;
            }
          }
        }
      }
    }
    walk(el);
    return mergeTexts(nodes);
  }

  /* ================= 块级 AST ================= */

  // Markdown 文本 → 文档 AST
  function parse(src) {
    src = String(src).replace(/\r\n?/g, '\n');
    var lines = src.split('\n');
    var blocks = [];
    var i = 0, n = lines.length;
    while (i < n) {
      var line = lines[i];
      if (isBlank(line)) { i++; continue; }
      var m;
      if ((m = line.match(/^\s*```(\S*)/))) { // 代码块
        var lang = m[1];
        var code = [];
        i++;
        while (i < n && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
        if (i < n) i++;
        blocks.push({ kind: 'code', lang: lang, text: code.join('\n') });
        continue;
      }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        blocks.push({ kind: 'heading', level: m[1].length, children: parseInlines(m[2]) });
        i++;
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        blocks.push({ kind: 'hr' });
        i++;
        continue;
      }
      if ((m = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/))) {
        var ordered = /\d+\./.test(m[1]);
        var items = [];
        while (i < n) {
          var lm2 = lines[i].match(ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/);
          if (!lm2) break;
          items.push({ kind: 'listitem', children: parseInlines(lm2[1]) });
          i++;
        }
        blocks.push({ kind: 'list', ordered: ordered, items: items });
        continue;
      }
      if ((m = line.match(/^>\s?(.*)$/))) {
        var q = [m[1]];
        i++;
        while (i < n && (m = lines[i].match(/^>\s?(.*)$/))) { q.push(m[1]); i++; }
        var qnodes = [];
        for (var qi = 0; qi < q.length; qi++) {
          if (qi > 0) qnodes.push({ kind: 'softbreak' });
          qnodes = qnodes.concat(parseInlines(q[qi]));
        }
        blocks.push({ kind: 'quote', children: qnodes });
        continue;
      }
      // 段落（连续非空非块起始行合并，行间以 softbreak 连接）
      var para = [line];
      i++;
      while (i < n &&
        !isBlank(lines[i]) &&
        !/^(#{1,6})\s/.test(lines[i]) &&
        !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
        !/^>\s?/.test(lines[i]) &&
        !/^\s*```/.test(lines[i]) &&
        !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      var pnodes = [];
      for (var pi = 0; pi < para.length; pi++) {
        if (pi > 0) pnodes.push({ kind: 'softbreak' });
        pnodes = pnodes.concat(parseInlines(para[pi]));
      }
      blocks.push({ kind: 'paragraph', children: pnodes });
    }
    // 恢复尾部空段落（编辑器序列化时每个空段落对应两个换行，保证 AST⇄源码往返稳定）
    var trailing = 0;
    for (var t = n - 1; t >= 0 && isBlank(lines[t]); t--) trailing++;
    for (var e = 0; e < Math.floor(trailing / 2); e++) {
      blocks.push({ kind: 'paragraph', children: [] });
    }
    return { kind: 'document', blocks: blocks };
  }

  // 文档 AST → Markdown 文本
  function serialize(doc) {
    return doc.blocks.map(serializeBlock).join('\n\n');
  }

  function serializeBlock(b) {
    switch (b.kind) {
      case 'heading': return '#'.repeat(b.level) + ' ' + serializeInlines(b.children);
      case 'paragraph': return serializeInlines(b.children);
      case 'code': return '```' + (b.lang || '') + '\n' + b.text + '\n```';
      case 'list':
        return b.items.map(function (it, i) {
          return (b.ordered ? (i + 1) + '. ' : '- ') + serializeInlines(it.children);
        }).join('\n');
      case 'quote': return '> ' + serializeInlines(b.children).split('\n').join('\n> ');
      case 'hr': return '---';
    }
    return '';
  }

  // 文档 AST → HTML（编辑器块渲染；块间无外层容器）
  function renderBlocksHTML(doc) {
    return doc.blocks.map(renderBlockHTML).join('');
  }

  function renderBlockHTML(b) {
    switch (b.kind) {
      case 'heading': return '<h' + b.level + '>' + renderInlines(b.children) + '</h' + b.level + '>';
      case 'paragraph': {
        var inner = renderInlines(b.children);
        return '<p>' + (inner === '' ? '<br>' : inner) + '</p>';
      }
      case 'code': return '<pre><code>' + escapeHtml(b.text) + '</code></pre>';
      case 'list':
        return '<' + (b.ordered ? 'ol' : 'ul') + '>' +
          b.items.map(function (it) {
            var inner = renderInlines(it.children);
            return '<li>' + (inner === '' ? '<br>' : inner) + '</li>';
          }).join('') +
          '</' + (b.ordered ? 'ol' : 'ul') + '>';
      case 'quote': return '<blockquote>' + renderInlines(b.children) + '</blockquote>';
      case 'hr': return '<hr>';
    }
    return '<p><br></p>';
  }

  // 块是否为空（无任何文本内容）
  function blockEmpty(b) {
    switch (b.kind) {
      case 'heading': case 'paragraph': case 'quote': return inlineTextLen(b.children) === 0;
      case 'code': return b.text === '';
      case 'list': return b.items.length === 0;
      case 'hr': return false;
    }
    return false;
  }

  window.MD = {
    parse: parse,
    serialize: serialize,
    parseInlines: parseInlines,
    serializeInlines: serializeInlines,
    renderInlines: renderInlines,
    renderBlockHTML: renderBlockHTML,
    renderBlocksHTML: renderBlocksHTML,
    inlinesFromDOM: inlinesFromDOM,
    inlineTextLen: inlineTextLen,
    splitInlinesAt: splitInlinesAt,
    insertIntoInlines: insertIntoInlines,
    leadingMarker: leadingMarker,
    stripMarker: stripMarker,
    blockEmpty: blockEmpty
  };
})();
