/**
 * 轻量 Markdown 引擎（v1.5）
 * - renderMarkdown(src)              整段渲染（静态预览）
 * - splitBlocks(lines)               文档按行切块（含代码块语言、末尾空段落）
 * - inlineMapped(text)               行内渲染 + 源码位置 ⇄ DOM 文本位置映射（供所见即所得编辑器恢复光标）
 * - renderBlockMapped(lines, kind)   单块渲染 + 块级位置映射
 *
 * 支持：标题、分隔线、引用、无序/有序列表、代码块与行内代码、
 *       链接、图片、粗体/斜体/删除线、段落换行。
 * 所有文本渲染前统一 HTML 转义，链接/图片仅允许安全协议。
 * 软换行按标准 Markdown 处理（空格连接，不产生 <br>）。
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

  function safeUrl(url) {
    return /^(https?:\/\/|\/|#|\.{0,2}\/)/.test(url);
  }

  /* ---------- 行内语法（静态渲染） ---------- */
  function inline(text) {
    text = escapeHtml(text);
    text = text.replace(/`([^`]+)`/g, function (m, code) {
      return '<code>' + code + '</code>';
    });
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      if (!safeUrl(url)) return m;
      return '<img src="' + url + '" alt="' + alt + '">';
    });
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, label, url) {
      if (!safeUrl(url)) return m;
      return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/(^|[^_])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return text;
  }

  /* ---------- 块级判断 ---------- */
  function isBlank(l) { return /^\s*$/.test(l); }
  function isFence(l) { return /^\s*```/.test(l); }
  function isHeading(l) { return /^(#{1,6})\s+/.test(l); }
  function isHr(l) { return /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l); }
  function isQuote(l) { return /^>\s?/.test(l); }
  function isUl(l) { return /^\s*[-*+]\s+/.test(l); }
  function isOl(l) { return /^\s*\d+\.\s+/.test(l); }

  function kindOf(l) {
    if (isFence(l)) return 'code';
    if (isHeading(l)) return 'heading';
    if (isHr(l)) return 'hr';
    if (isQuote(l)) return 'quote';
    if (isUl(l)) return 'ul';
    if (isOl(l)) return 'ol';
    return 'para';
  }

  /**
   * 切分块：返回 [{kind, start, end}]（行号区间，end 不含）。
   * 文档末尾的空行视为一个空段落块（便于编辑器在文末回车续写）。
   */
  function splitBlocks(lines) {
    var blocks = [];
    var i = 0, n = lines.length;
    while (i < n) {
      if (isBlank(lines[i])) { i++; continue; }
      var kind = kindOf(lines[i]);
      var start = i;
      if (kind === 'code') {
        var lm = lines[i].match(/^\s*```(\S*)/);
        var lang = lm ? lm[1] : '';
        i++; // 跳过围栏起始行
        while (i < n && !isFence(lines[i])) i++;
        if (i < n) i++; // 跳过围栏结束行
        blocks.push({ kind: kind, start: start, end: i, lang: lang });
        continue;
      }
      if (kind === 'heading' || kind === 'hr') {
        blocks.push({ kind: kind, start: i, end: i + 1 });
        i++;
        continue;
      }
      if (kind === 'quote' || kind === 'ul' || kind === 'ol') {
        i++;
        while (i < n && !isBlank(lines[i]) && kindOf(lines[i]) === kind) i++;
        blocks.push({ kind: kind, start: start, end: i });
        continue;
      }
      // 段落：收集到空行或其他块类型开头
      i++;
      while (i < n && !isBlank(lines[i]) && kindOf(lines[i]) === 'para') i++;
      blocks.push({ kind: 'para', start: start, end: i });
    }
    // 末尾空行 = 一个空段落块
    if (n > 0 && isBlank(lines[n - 1])) {
      blocks.push({ kind: 'para', start: n - 1, end: n });
    }
    return blocks;
  }

  /* ---------- 整段渲染 ---------- */
  function renderMarkdown(src) {
    if (!src) return '';
    src = String(src).replace(/\r\n?/g, '\n');

    // 1. 先取出围栏代码块，避免内部内容被当作块语法处理
    var codes = [];
    src = src.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, function (m, info, body) {
      codes.push('<pre><code>' + escapeHtml(body.replace(/\n$/, '')) + '</code></pre>');
      return '\u0000C' + (codes.length - 1) + '\u0000';
    });

    var lines = src.split('\n');
    var html = '';
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var m;

      if (/^\s*$/.test(line)) { i++; continue; }

      // 代码块占位符
      if ((m = line.match(/^\u0000C(\d+)\u0000/))) {
        html += codes[+m[1]];
        i++;
        continue;
      }

      // 标题
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        var lv = m[1].length;
        html += '<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>';
        i++;
        continue;
      }

      // 分隔线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html += '<hr>';
        i++;
        continue;
      }

      // 引用（支持嵌套）
      if ((m = line.match(/^>\s?(.*)$/))) {
        var quote = [];
        while (i < lines.length && (m = lines[i].match(/^>\s?(.*)$/))) {
          quote.push(m[1]);
          i++;
        }
        html += '<blockquote>' + renderMarkdown(quote.join('\n')) + '</blockquote>';
        continue;
      }

      // 无序列表
      if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        var items = [];
        while (i < lines.length && (m = lines[i].match(/^\s*[-*+]\s+(.*)$/))) {
          items.push('<li>' + inline(m[1]) + '</li>');
          i++;
        }
        html += '<ul>' + items.join('') + '</ul>';
        continue;
      }

      // 有序列表
      if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
        var oitems = [];
        while (i < lines.length && (m = lines[i].match(/^\s*\d+\.\s+(.*)$/))) {
          oitems.push('<li>' + inline(m[1]) + '</li>');
          i++;
        }
        html += '<ol>' + oitems.join('') + '</ol>';
        continue;
      }

      // 普通段落：软换行按标准 Markdown 处理（空格连接，不产生 <br>）
      var para = [];
      while (i < lines.length) {
        var l = lines[i];
        if (/^\s*$/.test(l) || /^(#{1,6})\s/.test(l) || /^\s*[-*+]\s+/.test(l) ||
            /^\s*\d+\.\s+/.test(l) || /^>\s?/.test(l) ||
            /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) || /^\u0000C\d+\u0000/.test(l) || /^\s*```/.test(l)) {
          break;
        }
        para.push(l);
        i++;
      }
      html += '<p>' + inline(para.join(' ')) + '</p>';
    }

    return html;
  }

  // 渲染单个块（静态）
  function renderBlock(lines, kind) {
    return renderMarkdown(lines.join('\n'));
  }

  /* ---------- 行内渲染 + 位置映射 ----------
   * piece = { pre, content, post, html, preHtml, postHtml }
   *   pre/content/post：源码长度（content 长度 == DOM 文本长度）
   *   html：核心 HTML；preHtml/postHtml：包装 HTML（如 <li></li>）
   * 由 pieces 组装出：html、domAtSrc[srcLen+1]（源码边界 → DOM 文本边界）、
   * srcAtDom[domLen+1]（DOM 文本边界 → 源码边界）
   */
  function inlinePieces(text) {
    text = String(text);
    var re = /(`[^`]+`|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|~~[^~]+~~)/g;
    var pieces = [];
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) {
        var plain = text.slice(last, m.index);
        pieces.push({ pre: 0, content: plain.length, post: 0, html: escapeHtml(plain) });
      }
      var s = m[0];
      var p = null;
      if (s[0] === '`' && s.length > 2) {
        var c = s.slice(1, -1);
        p = { pre: 1, content: c.length, post: 1, html: '<code>' + escapeHtml(c) + '</code>' };
      } else if (s[0] === '!' && s[1] === '[') {
        var im = s.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
        if (im && safeUrl(im[2])) p = { pre: 2 + im[1].length + 2 + im[2].length + 1, content: 0, post: 0, html: '<img src="' + im[2] + '" alt="' + im[1] + '">' };
      } else if (s[0] === '[') {
        var lm2 = s.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
        if (lm2 && safeUrl(lm2[2])) p = { pre: 1, content: lm2[1].length, post: 2 + lm2[2].length + 1, html: '<a href="' + lm2[2] + '" target="_blank" rel="noopener">' + escapeHtml(lm2[1]) + '</a>' };
      } else if (s.slice(0, 2) === '~~' && s.length > 4) {
        var d = s.slice(2, -2);
        p = { pre: 2, content: d.length, post: 2, html: '<del>' + escapeHtml(d) + '</del>' };
      } else if ((s.slice(0, 2) === '**' || s.slice(0, 2) === '__') && s.length > 4) {
        var b2 = s.slice(2, -2);
        p = { pre: 2, content: b2.length, post: 2, html: '<strong>' + escapeHtml(b2) + '</strong>' };
      } else if (s[0] === '*' && s.length > 2) {
        var e2 = s.slice(1, -1);
        p = { pre: 1, content: e2.length, post: 1, html: '<em>' + escapeHtml(e2) + '</em>' };
      }
      if (p) pieces.push(p);
      else pieces.push({ pre: 0, content: s.length, post: 0, html: escapeHtml(s) });
      last = m.index + s.length;
    }
    if (last < text.length) {
      var tail = text.slice(last);
      pieces.push({ pre: 0, content: tail.length, post: 0, html: escapeHtml(tail) });
    }
    return pieces;
  }

  // 行内渲染（带映射）
  function inlineMapped(text) {
    return assemble(inlinePieces(text));
  }

  // 由 pieces 组装 html 与双向映射
  function assemble(pieces) {
    var html = '';
    var domAtSrc = [0];  // 长度 = 总源码长度 + 1
    var srcAtDom = [0];  // 长度 = 总 DOM 文本长度 + 1
    var srcPos = 0, domPos = 0;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      html += (p.preHtml || '') + (p.html || '') + (p.postHtml || '');
      for (var j = 0; j < p.pre; j++) domAtSrc.push(domPos);
      for (var k = 0; k < p.content; k++) { domPos++; domAtSrc.push(domPos); }
      for (var j2 = 0; j2 < p.post; j2++) domAtSrc.push(domPos);
      if (p.content === 0 && p.pre > 0) {
        // 空内容的隐藏段（如空标题/空列表项）：该 DOM 边界应指向"标记之后"
        srcAtDom[srcAtDom.length - 1] = srcPos + p.pre;
      }
      for (var k2 = 1; k2 <= p.content; k2++) srcAtDom.push(srcPos + p.pre + k2);
      srcPos += p.pre + p.content + p.post;
    }
    return { html: html, domAtSrc: domAtSrc, srcAtDom: srcAtDom };
  }

  // 隐藏源码片段（行首标记等）
  function markerPiece(srcLen) {
    return { pre: srcLen, content: 0, post: 0, html: '' };
  }

  // 纯 HTML 片段（如 <br>、<li> 包装）
  function htmlPiece(preHtml, postHtml, inner) {
    return { pre: 0, content: 0, post: 0, html: inner || '', preHtml: preHtml || '', postHtml: postHtml || '' };
  }

  /**
   * 单块渲染 + 映射（供所见即所得编辑器使用）
   * lines: 该块的源码行；kind: 块类型；lang: 代码块语言
   * 返回 { html, domAtSrc, srcAtDom }
   */
  function renderBlockMapped(lines, kind, lang) {
    var pieces = [];
    var tag = 'p';
    var preHtml = '', postHtml = '';

    if (kind === 'heading') {
      var hm = (lines[0] || '').match(/^(#{1,6})\s+(.*)$/) || ['', '#', ''];
      tag = 'h' + hm[1].length;
      pieces.push(markerPiece(hm[1].length + 1));
      pieces = pieces.concat(inlinePieces(hm[2]));
    } else if (kind === 'ul' || kind === 'ol') {
      tag = kind === 'ul' ? 'ul' : 'ol';
      for (var u = 0; u < lines.length; u++) {
        if (u > 0) pieces.push(markerPiece(1)); // 行间 \n
        var um = lines[u].match(/^\s*([-*+]|\d+\.)\s+(.*)$/) || ['', '-', ''];
        pieces.push(markerPiece(um[1].length + 1));
        var inner = inlinePieces(um[2]);
        if (inner.length) {
          inner[0].preHtml = '<li>' + (inner[0].preHtml || '');
          inner[inner.length - 1].postHtml = (inner[inner.length - 1].postHtml || '') + '</li>';
          pieces = pieces.concat(inner);
        } else {
          pieces.push(htmlPiece('<li>', '</li>', ''));
        }
      }
    } else if (kind === 'quote') {
      tag = 'blockquote';
      for (var q = 0; q < lines.length; q++) {
        if (q > 0) pieces.push(markerPiece(1));
        var qm = lines[q].match(/^>\s?(.*)$/) || ['', ''];
        var qmark = qm[0].indexOf(' ') > -1 ? 2 : 1;
        pieces.push(markerPiece(qmark));
        pieces = pieces.concat(inlinePieces(qm[1]));
        if (q < lines.length - 1) pieces.push(htmlPiece('', '', '<br>'));
      }
    } else if (kind === 'code') {
      pieces.push(markerPiece(('```' + (lang || '') + '\n').length));
      var codeText = lines.join('\n');
      pieces.push({ pre: 0, content: codeText.length, post: 0, html: escapeHtml(codeText) });
      pieces.push(markerPiece('\n```'.length));
      var asm = assemble(pieces);
      return { html: '<pre><code>' + asm.html + '</code></pre>', domAtSrc: asm.domAtSrc, srcAtDom: asm.srcAtDom };
    } else if (kind === 'hr') {
      return { html: '<hr>', domAtSrc: [0, 0, 0, 0], srcAtDom: [0] };
    } else {
      // para：多行时行间 \n 对应 <br>（编辑态展示，序列化还原为 \n）
      for (var w = 0; w < lines.length; w++) {
        if (w > 0) pieces.push(markerPiece(1));
        pieces = pieces.concat(inlinePieces(lines[w]));
        if (w < lines.length - 1) pieces.push(htmlPiece('', '', '<br>'));
      }
    }

    var assembled = assemble(pieces);
    return {
      html: preHtml + '<' + tag + '>' + assembled.html + '</' + tag + '>' + postHtml,
      domAtSrc: assembled.domAtSrc,
      srcAtDom: assembled.srcAtDom
    };
  }

  window.MD = {
    renderMarkdown: renderMarkdown,
    renderBlock: renderBlock,
    splitBlocks: splitBlocks,
    inlineMapped: inlineMapped,
    renderBlockMapped: renderBlockMapped,
    escapeHtml: escapeHtml
  };
})();
