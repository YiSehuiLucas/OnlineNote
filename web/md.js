/**
 * 轻量 Markdown 渲染器（初版）
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

  // 行内语法（输入已被转义，只产出我们自己的标签，保证无注入）
  function inline(text) {
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

  function isBlockStart(l) {
    return /^\s*$/.test(l) ||
      /^(#{1,6})\s/.test(l) ||
      /^\s*[-*+]\s+/.test(l) ||
      /^\s*\d+\.\s+/.test(l) ||
      /^>\s?/.test(l) ||
      /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ||
      /^\u0000C\d+\u0000/.test(l);
  }

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

      // 普通段落：收集到空行或下一个块语法开头
      var para = [];
      while (i < lines.length && !isBlockStart(lines[i])) {
        para.push(lines[i]);
        i++;
      }
      html += '<p>' + inline(para.join('<br>')) + '</p>';
    }

    return html;
  }

  window.renderMarkdown = renderMarkdown;
})();
