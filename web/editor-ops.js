/**
 * 编辑器源码操作层（纯函数，无 DOM 依赖，可单元测试）
 * 输入/输出均为文档源行数组 lines 与块数组 blocks（MD.splitBlocks 的结果）。
 * 操作返回 { lines, caret }，caret = { line, off } 为新文档中的光标位置。
 */
(function () {
  'use strict';

  function isTextish(kind) {
    return kind === 'para' || kind === 'heading';
  }

  function blockText(lines, b) {
    return lines.slice(b.start, b.end).join('\n');
  }

  // 行内（块内）偏移 → 所在行号与列号
  function lineCol(text, off) {
    var before = text.slice(0, off);
    var line = before.split('\n').length - 1;
    var col = off - (before.lastIndexOf('\n') + 1);
    return { line: line, col: col };
  }

  /**
   * 回车：i 块内源码偏移 off 处换行。
   * 段落：行尾 → 新空段；行中 → 拆为两段。
   * 标题：后半部分成为新段落（Typora 语义）。
   * 列表/引用：拆出新的同类型行（续行不加空行）。
   * 代码块：插入普通换行。
   */
  function enterOp(lines, blocks, i, off) {
    var b = blocks[i];
    var raw = blockText(lines, b);
    var blines = lines.slice(b.start, b.end);
    var head = lines.slice(0, b.start);
    var tail = lines.slice(b.end);
    var newLines;
    var caretLine; // 新文档中光标所在行
    var caretOff = 0;

    if (b.kind === 'code') {
      var joined = raw.slice(0, off) + '\n' + raw.slice(off);
      newLines = joined.split('\n');
      caretLine = b.start + raw.slice(0, off).split('\n').length - 1 + 1;
      caretOff = 0;
    } else if (b.kind === 'heading') {
      var lc = lineCol(raw, off);
      var left = blines[0].slice(0, lc.col);
      var right = blines[0].slice(lc.col).replace(/^\s*/, '');
      newLines = [left];
      if (right === '') {
        newLines.push('', ''); // 空行分隔 + 空段
        caretLine = b.start + 2;
      } else {
        newLines.push('', right);
        caretLine = b.start + 2;
      }
    } else if (b.kind === 'ul' || b.kind === 'ol' || b.kind === 'quote') {
      var lc2 = lineCol(raw, off);
      var mk = b.kind === 'quote' ? '> ' : (b.kind === 'ol' ? (lc2.line + 2) + '. ' : '- ');
      var cur = blines[lc2.line];
      var m = cur.match(b.kind === 'quote' ? /^>\s?/ : /^\s*([-*+]|\d+\.)\s+/);
      var mlen = m ? m[0].length : 0;
      var body = cur.slice(mlen);
      var colInBody = Math.max(0, lc2.col - mlen);
      var leftBody = body.slice(0, colInBody);
      var rightBody = body.slice(colInBody);
      var newLeft = (m ? m[0] : mk) + leftBody;
      var newRight = mk + rightBody;
      var nl = blines.slice(0, lc2.line).concat([newLeft]);
      if (rightBody === '') {
        nl.push(mk); // 空列表项/引用行
        caretLine = b.start + lc2.line + 1;
      } else {
        nl.push(newRight);
        caretLine = b.start + lc2.line + 1;
      }
      newLines = nl.concat(blines.slice(lc2.line + 1));
    } else {
      // 段落
      var lc3 = lineCol(raw, off);
      var leftP = blines[lc3.line].slice(0, lc3.col);
      var rightP = blines[lc3.line].slice(lc3.col);
      var nl2 = blines.slice(0, lc3.line).concat([leftP]);
      if (rightP === '') {
        // 行尾回车：插入分隔空行 + 空段落行（两行），保证后续输入不并入上一段
        nl2.push('', '');
        caretLine = b.start + lc3.line + 2;
      } else {
        nl2.push('', rightP);
        caretLine = b.start + lc3.line + 2;
      }
      newLines = nl2.concat(blines.slice(lc3.line + 1));
    }

    var out = head.concat(newLines, tail);
    return { lines: out, caret: { line: caretLine, off: caretOff } };
  }

  /**
   * Backspace：i 块内偏移 off 处删除。
   * 块内 → 删除前一个字符；块首 → 与上一块合并/删除空块/删除分隔线。
   */
  function backspaceOp(lines, blocks, i, off) {
    var b = blocks[i];
    if (off > 0) {
      var raw = blockText(lines, b);
      var newRaw = raw.slice(0, off - 1) + raw.slice(off);
      var out = lines.slice(0, b.start).concat(newRaw.split('\n'), lines.slice(b.end));
      var lc = lineCol(newRaw, off - 1);
      return { lines: out, caret: { line: b.start + lc.line, off: lc.col } };
    }
    if (i === 0) return { lines: lines, caret: { line: b.start, off: 0 } };
    var prev = blocks[i - 1];
    var prevRaw = blockText(lines, prev);
    var curRaw = blockText(lines, b);
    var prevEmpty = prevRaw.replace(/[\s\n]/g, '') === '';
    var curEmpty = curRaw.replace(/[\s\n]/g, '') === '';

    if (prev.kind === 'hr') {
      // 删除分隔线及其后空行，光标移到分隔线上一块末尾
      var skipAfter = (prev.end < lines.length && lines[prev.end].trim() === '') ? 1 : 0;
      var out2 = lines.slice(0, prev.start).concat(lines.slice(prev.end + skipAfter));
      var targetB = blocks[i - 2];
      var tRaw = targetB ? blockText(lines, targetB) : '';
      var lcT = lineCol(tRaw, tRaw.length);
      return { lines: out2, caret: { line: targetB ? targetB.start + lcT.line : 0, off: lcT.col } };
    }
    if (prevEmpty) {
      // 删除上一空块（连同其前分隔空行）
      var sepPrev = (prev.start > 0 && lines[prev.start - 1].trim() === '') ? 1 : 0;
      var outP = lines.slice(0, prev.start - sepPrev).concat(lines.slice(prev.end));
      return { lines: outP, caret: { line: b.start - (prev.end - prev.start) - sepPrev, off: 0 } };
    }
    if (curEmpty) {
      // 删除当前空块（连同其前一个分隔空行），光标落在上一块末尾
      var sep = (b.start > 0 && lines[b.start - 1].trim() === '') ? 1 : 0;
      var out3 = lines.slice(0, b.start - sep).concat(lines.slice(b.end));
      var prevRaw2 = blockText(lines, prev);
      var lc2 = lineCol(prevRaw2, prevRaw2.length);
      return { lines: out3, caret: { line: prev.start + lc2.line, off: lc2.col } };
    }
    if (prev.kind === b.kind || (isTextish(prev.kind) && isTextish(b.kind))) {
      // 合并：文本类边界用空格连接
      var prevLines = lines.slice(prev.start, prev.end);
      var curLines = lines.slice(b.start, b.end);
      var merged = prevLines.concat(curLines);
      var caretOffAt = prevRaw.length;
      if (isTextish(prev.kind) && isTextish(b.kind)) {
        merged[prevLines.length - 1] = prevLines[prevLines.length - 1] + ' ' + curLines[0];
        merged.splice(prevLines.length, 1);
        caretOffAt += 1;
      }
      var out4 = lines.slice(0, prev.start).concat(merged, lines.slice(b.end));
      var lc3 = lineCol(merged.join('\n'), caretOffAt);
      return { lines: out4, caret: { line: prev.start + lc3.line, off: lc3.col } };
    }
    // 类型不同：仅移动光标到上一块末尾
    var lc4 = lineCol(prevRaw, prevRaw.length);
    return { lines: lines, caret: { line: prev.start + lc4.line, off: lc4.col } };
  }

  /**
   * Delete：i 块内偏移 off 处向后删除。
   * 块内 → 删除后一个字符；块尾 → 与下一块合并/删除空块/删除分隔线。
   */
  function deleteOp(lines, blocks, i, off) {
    var b = blocks[i];
    var raw = blockText(lines, b);
    if (off < raw.length) {
      var newRaw = raw.slice(0, off) + raw.slice(off + 1);
      var out = lines.slice(0, b.start).concat(newRaw.split('\n'), lines.slice(b.end));
      var lc = lineCol(newRaw, off);
      return { lines: out, caret: { line: b.start + lc.line, off: lc.col } };
    }
    if (i >= blocks.length - 1) {
      var lcE = lineCol(raw, raw.length);
      return { lines: lines, caret: { line: b.start + lcE.line, off: lcE.col } };
    }
    var next = blocks[i + 1];
    var nextRaw = blockText(lines, next);
    var curEmpty = raw.replace(/[\s\n]/g, '') === '';
    var nextEmpty = nextRaw.replace(/[\s\n]/g, '') === '';

    if (curEmpty) {
      // 删除当前空块（连同其前一个分隔空行），光标落在下一块开头
      var sep = (b.start > 0 && lines[b.start - 1].trim() === '') ? 1 : 0;
      var out3 = lines.slice(0, b.start - sep).concat(lines.slice(b.end));
      return { lines: out3, caret: { line: b.start - sep, off: 0 } };
    }
    if (next.kind === 'hr') {
      // 删除分隔线及其后空行
      var skipAfter = (next.end < lines.length && lines[next.end].trim() === '') ? 1 : 0;
      var out2 = lines.slice(0, next.start).concat(lines.slice(next.end + skipAfter));
      var lcE2 = lineCol(raw, raw.length);
      return { lines: out2, caret: { line: b.start + lcE2.line, off: lcE2.col } };
    }
    if (nextEmpty) {
      // 删除下一空块（连同其前分隔空行），光标留在当前块末尾
      var sepN = (next.start > 0 && lines[next.start - 1].trim() === '') ? 1 : 0;
      var outN = lines.slice(0, next.start - sepN).concat(lines.slice(next.end));
      var lcN = lineCol(raw, raw.length);
      return { lines: outN, caret: { line: b.start + lcN.line, off: lcN.col } };
    }
    if (b.kind === next.kind || (isTextish(b.kind) && isTextish(next.kind))) {
      var curLines = lines.slice(b.start, b.end);
      var nextLines = lines.slice(next.start, next.end);
      var merged = curLines.concat(nextLines);
      var caretOffAt = raw.length;
      if (isTextish(b.kind) && isTextish(next.kind)) {
        merged[curLines.length - 1] = curLines[curLines.length - 1] + ' ' + nextLines[0];
        merged.splice(curLines.length, 1);
        caretOffAt += 1;
      }
      var out4 = lines.slice(0, b.start).concat(merged, lines.slice(next.end));
      var lc3 = lineCol(merged.join('\n'), caretOffAt);
      return { lines: out4, caret: { line: b.start + lc3.line, off: lc3.col } };
    }
    var lcN2 = lineCol(nextRaw, 0);
    return { lines: lines, caret: { line: next.start + lcN2.line, off: 0 } };
  }

  /**
   * 在 i 块偏移 off 处插入文本（单行文本，粘贴用）。
   */
  function insertTextOp(lines, blocks, i, off, text) {
    text = String(text).replace(/\r\n/g, '\n');
    var b = blocks[i];
    var raw = blockText(lines, b);
    var newRaw = raw.slice(0, off) + text + raw.slice(off);
    var out = lines.slice(0, b.start).concat(newRaw.split('\n'), lines.slice(b.end));
    var lc = lineCol(newRaw, off + text.length);
    return { lines: out, caret: { line: b.start + lc.line, off: lc.col } };
  }

  window.EditorOps = {
    enterOp: enterOp,
    backspaceOp: backspaceOp,
    deleteOp: deleteOp,
    insertTextOp: insertTextOp
  };
})();
