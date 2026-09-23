/**
 * 轻量 Markdown 渲染引擎 v3（重写）
 *
 * 仅支持六种语法：
 *   1. 标题         # 一级标题 ~ ###### 六级标题
 *   2. 无序列表     - 项目
 *   3. 有序列表     1. 项目
 *   4. 分隔线       ---
 *   5. 行内代码     `code`
 *   6. 围栏代码块   ```  ```
 *
 * 模型 = 纯文本行数组（与磁盘文件逐字符一致，序列化即 join('\n')）。
 * 渲染 = 行 → 块；语法标记字符（#、-、1.、`、```）始终保留在 DOM 文本里，
 * 由 CSS 控制隐藏/显示（编辑当前行时显示），因此 DOM 文本与源码文本一一对应，
 * 光标偏移不需要任何映射换算。
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

  // 行内渲染：`code` → <code class="md-cs"><span class="md-mark">`</span>…</code>
  // 反引号保留在 DOM 文本中（CSS 隐藏，编辑当前行时显示）
  function renderInline(text) {
    var parts = String(text).split('`');
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        out += escapeHtml(parts[i]);
      } else if (i < parts.length - 1) {          // 成对反引号 → 行内代码
        out += '<code class="md-cs"><span class="md-mark">`</span>' +
          escapeHtml(parts[i]) +
          '<span class="md-mark">`</span></code>';
      } else {                                    // 未闭合反引号 → 字面量
        out += '`' + escapeHtml(parts[i]);
      }
    }
    return out;
  }

  // 单行语法判定（围栏代码块在 parseBlocks 里跨行处理）
  function lineType(line) {
    var m;
    if ((m = line.match(/^(#{1,6})[ \t]+(.*)$/))) {
      return {
        type: 'heading',
        level: m[1].length,
        marker: m[1] + m[0].slice(m[1].length, m[0].length - m[2].length),
        body: m[2]
      };
    }
    if (/^(-{3,})[ \t]*$/.test(line)) return { type: 'hr' };
    if ((m = line.match(/^(-|\d+\.)[ \t]+(.*)$/))) {
      return {
        type: 'li',
        ordered: m[1] !== '-',
        marker: m[1] + m[0].slice(m[1].length, m[0].length - m[2].length),
        body: m[2]
      };
    }
    return { type: 'para', body: line };
  }

  // 行数组 → 块数组。text 恒等于 lines[start..end].join('\n')（DOM 文本不变量）
  function parseBlocks(lines) {
    var blocks = [];
    var i = 0, n = lines.length;
    while (i < n) {
      var line = lines[i];
      if (/^```/.test(line)) {                    // 围栏代码块
        var lang = line.slice(3);
        var j = i + 1;
        while (j < n && !/^```/.test(lines[j])) j++;
        var end = j < n ? j : n - 1;
        blocks.push({ type: 'code', start: i, end: end, lang: lang, text: lines.slice(i, end + 1).join('\n') });
        i = end + 1;
        continue;
      }
      var t = lineType(line);
      var b = { type: t.type, start: i, end: i, text: line };
      if (t.type === 'heading') { b.level = t.level; b.marker = t.marker; b.body = t.body; }
      else if (t.type === 'li') { b.ordered = t.ordered; b.marker = t.marker; b.body = t.body; }
      blocks.push(b);
      i++;
    }
    return blocks;
  }

  window.MD = {
    escapeHtml: escapeHtml,
    renderInline: renderInline,
    lineType: lineType,
    parseBlocks: parseBlocks
  };
})();
