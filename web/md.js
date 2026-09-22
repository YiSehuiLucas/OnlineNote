/**
 * 轻量 Markdown 引擎（v1.2）
 * - renderMarkdown(src)          整段渲染（块级 + 行内语法）
 * - splitBlocks(lines)           将文档按行切分为块，供"点击块就地编辑"使用
 * - renderBlock(lines, kind)     渲染单个块
 *
 * 支持：标题、分隔线、引用、无序/有序列表、代码块与行内代码、
 *       链接、图片、粗体/斜体/删除线、段落与换行。
 * 所有文本渲染前统一 HTML 转义，链接/图片仅允许安全协议。
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

  /* ---------- 行内语法（先统一转义，只产出我们自己的标签，杜绝注入） ---------- */
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
   * 保留原始行内容不变，仅做结构划分。
   */
  function splitBlocks(lines) {
    var blocks = [];
    var i = 0, n = lines.length;
    while (i < n) {
      if (isBlank(lines[i])) { i++; continue; }
      var kind = kindOf(lines[i]);
      var start = i;
      if (kind === 'code') {
        i++; // 跳过围栏起始行
        while (i < n && !isFence(lines[i])) i++;
        if (i < n) i++; // 跳过围栏结束行
        blocks.push({ kind: kind, start: start, end: i });
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

      // 普通段落：收集到空行或下一个块语法开头；单次换行按标准 Markdown 软换行处理（空格连接，不产生 <br>）
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

  // 渲染单个块（复用整段渲染器）
  function renderBlock(lines, kind) {
    return renderMarkdown(lines.join('\n'));
  }

  window.MD = {
    renderMarkdown: renderMarkdown,
    renderBlock: renderBlock,
    splitBlocks: splitBlocks
  };
})();
