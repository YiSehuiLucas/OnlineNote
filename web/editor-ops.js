/**
 * 编辑器 AST 操作层（纯函数，无 DOM 依赖，可单元测试）
 *
 * 模型：blocks = 文档块级 AST 数组（见 md.js），标记字符不存在于模型中。
 * 光标约定：caret = { idx, itemIdx?, off }，off 为块内 DOM 文本偏移（softbreak 记 0）。
 */
(function () {
  'use strict';

  function endOfBlock(blocks, i) {
    if (i < 0 || i >= blocks.length) {
      if (blocks.length === 0) return { idx: 0, off: 0 };
      i = i < 0 ? 0 : blocks.length - 1;
    }
    var b = blocks[i];
    if (b.kind === 'list') {
      var last = b.items[b.items.length - 1];
      return { idx: i, itemIdx: b.items.length - 1, off: last ? MD.inlineTextLen(last.children) : 0 };
    }
    if (b.kind === 'code') return { idx: i, off: b.text.length };
    return { idx: i, off: MD.inlineTextLen(b.children) };
  }

  function emptyItem(item) {
    return MD.inlineTextLen(item.children) === 0;
  }

  /**
   * 回车：在块内 DOM 文本偏移 off 处换行。
   * 标题/引用/段落 → 拆分为两个块（行首回车则在上方插入空段）；
   * 代码块 → 插入普通换行；
   * 列表项 → 拆分为两个列表项；空尾项回车退出列表（Typora 语义）。
   */
  function enterInBlock(blocks, idx, itemIdx, off) {
    var caret;
    if (itemIdx >= 0) {
      var list = blocks[idx];
      var item = list.items[itemIdx];
      var sp = MD.splitInlinesAt(item.children, off);
      if (emptyItem(item) && off === 0 && itemIdx === list.items.length - 1) {
        // 空尾项回车：退出列表 → 普通段落
        list.items.pop();
        if (list.items.length === 0) {
          blocks[idx] = { kind: 'paragraph', children: [] };
          caret = { idx: idx, off: 0 };
        } else {
          blocks.splice(idx + 1, 0, { kind: 'paragraph', children: [] });
          caret = { idx: idx + 1, off: 0 };
        }
      } else {
        item.children = sp.left;
        list.items.splice(itemIdx + 1, 0, { kind: 'listitem', children: sp.right });
        caret = { idx: idx, itemIdx: itemIdx + 1, off: 0 };
      }
    } else {
      var b = blocks[idx];
      if (b.kind === 'code') {
        b.text = b.text.slice(0, off) + '\n' + b.text.slice(off);
        caret = { idx: idx, off: off + 1 };
      } else if (off === 0 && MD.blockEmpty(b)) {
        // 空块回车：在下方插入空段
        blocks.splice(idx + 1, 0, { kind: 'paragraph', children: [] });
        caret = { idx: idx + 1, off: 0 };
      } else if (off === 0 && (b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'quote')) {
        // 行首回车：在上方插入空段
        blocks.splice(idx, 0, { kind: 'paragraph', children: [] });
        caret = { idx: idx, off: 0 };
      } else if (b.kind === 'heading') {
        var sp2 = MD.splitInlinesAt(b.children, off);
        blocks[idx] = { kind: 'heading', level: b.level, children: sp2.left };
        blocks.splice(idx + 1, 0, { kind: 'paragraph', children: sp2.right });
        caret = { idx: idx + 1, off: 0 };
      } else if (b.kind === 'quote') {
        var sp3 = MD.splitInlinesAt(b.children, off);
        blocks[idx] = { kind: 'quote', children: sp3.left };
        blocks.splice(idx + 1, 0, { kind: 'paragraph', children: sp3.right });
        caret = { idx: idx + 1, off: 0 };
      } else {
        var sp4 = MD.splitInlinesAt(b.children, off);
        blocks[idx] = { kind: 'paragraph', children: sp4.left };
        blocks.splice(idx + 1, 0, { kind: 'paragraph', children: sp4.right });
        caret = { idx: idx + 1, off: 0 };
      }
    }
    return { blocks: blocks, caret: caret };
  }

  /**
   * Backspace（块首）：合并/删除/降级，光标落在合并点。
   * 标题/引用块首退格 → 降级为段落（Typora 语义）。
   */
  function backspaceAtStart(blocks, idx, itemIdx) {
    var caret;
    if (itemIdx >= 0) {
      var list = blocks[idx];
      var item = list.items[itemIdx];
      if (itemIdx > 0) {
        var prevItem = list.items[itemIdx - 1];
        var mergedLen = MD.inlineTextLen(prevItem.children);
        prevItem.children = prevItem.children.concat(item.children);
        list.items.splice(itemIdx, 1);
        caret = { idx: idx, itemIdx: itemIdx - 1, off: mergedLen };
      } else if (emptyItem(item)) {
        list.items.shift();
        if (list.items.length === 0) {
          blocks.splice(idx, 1);
          caret = endOfBlock(blocks, idx - 1);
        } else {
          caret = { idx: idx, itemIdx: 0, off: 0 };
        }
      } else if (idx > 0) {
        var prev = blocks[idx - 1];
        if (prev.kind === 'paragraph' || prev.kind === 'heading') {
          prev.children = prev.children.concat(item.children);
          var plen = MD.inlineTextLen(prev.children);
          list.items.shift();
          if (list.items.length === 0) blocks.splice(idx, 1);
          caret = { idx: idx - 1, off: plen };
        } else if (prev.kind === 'list') {
          prev.items = prev.items.concat(list.items);
          blocks.splice(idx, 1);
          caret = endOfBlock(blocks, idx - 1);
        } else {
          blocks.splice(idx, 0, { kind: 'paragraph', children: item.children });
          list.items.shift();
          if (list.items.length === 0) blocks.splice(idx + 1, 1);
          caret = { idx: idx, off: 0 };
        }
      } else {
        blocks.splice(idx, 0, { kind: 'paragraph', children: item.children });
        list.items.shift();
        if (list.items.length === 0) blocks.splice(idx + 1, 1);
        caret = { idx: idx, off: 0 };
      }
    } else {
      var b = blocks[idx];
      if (b.kind === 'heading' || b.kind === 'quote') {
        blocks[idx] = { kind: 'paragraph', children: b.children };
        caret = { idx: idx, off: 0 };
      } else if (idx === 0) {
        caret = { idx: 0, off: 0 };
      } else {
        var prev2 = blocks[idx - 1];
        if (prev2.kind === 'hr') {
          blocks.splice(idx - 1, 1);
          caret = endOfBlock(blocks, idx - 2);
        } else if (MD.blockEmpty(b)) {
          blocks.splice(idx, 1);
          caret = endOfBlock(blocks, idx - 1);
        } else if ((prev2.kind === 'paragraph' || prev2.kind === 'heading') && (b.kind === 'paragraph' || b.kind === 'heading')) {
          prev2.children = prev2.children.concat(b.children);
          var ml = MD.inlineTextLen(prev2.children);
          blocks.splice(idx, 1);
          caret = { idx: idx - 1, off: ml };
        } else if (prev2.kind === 'list' && (b.kind === 'paragraph' || b.kind === 'heading')) {
          var lastItem = prev2.items[prev2.items.length - 1];
          var il = MD.inlineTextLen(lastItem.children);
          lastItem.children = lastItem.children.concat(b.children);
          blocks.splice(idx, 1);
          caret = { idx: idx - 1, itemIdx: prev2.items.length - 1, off: il };
        } else if ((prev2.kind === 'paragraph' || prev2.kind === 'heading') && b.kind === 'list') {
          var fl = MD.inlineTextLen(b.items[0].children);
          prev2.children = prev2.children.concat(b.items[0].children);
          b.items.shift();
          if (b.items.length === 0) blocks.splice(idx, 1);
          caret = { idx: idx - 1, off: MD.inlineTextLen(prev2.children) - fl + fl };
        } else if (prev2.kind === 'list' && b.kind === 'list') {
          prev2.items = prev2.items.concat(b.items);
          blocks.splice(idx, 1);
          caret = endOfBlock(blocks, idx - 1);
        } else {
          caret = endOfBlock(blocks, idx - 1);
        }
      }
    }
    return { blocks: blocks, caret: caret };
  }

  /**
   * Delete（块尾）：合并下一块/删除空块/删除分隔线。
   */
  function deleteAtEnd(blocks, idx, itemIdx) {
    var caret;
    if (itemIdx >= 0) {
      var list = blocks[idx];
      var item = list.items[itemIdx];
      if (itemIdx < list.items.length - 1) {
        var nextItem = list.items[itemIdx + 1];
        var nl = MD.inlineTextLen(item.children);
        item.children = item.children.concat(nextItem.children);
        list.items.splice(itemIdx + 1, 1);
        caret = { idx: idx, itemIdx: itemIdx, off: nl };
      } else if (emptyItem(item)) {
        list.items.pop();
        if (list.items.length === 0) {
          blocks.splice(idx, 1);
          caret = startOfBlock(blocks, idx);
        } else {
          caret = { idx: idx, itemIdx: list.items.length - 1, off: 0 };
        }
      } else if (idx < blocks.length - 1) {
        var next = blocks[idx + 1];
        if (next.kind === 'paragraph' || next.kind === 'heading') {
          var ol = MD.inlineTextLen(item.children);
          item.children = item.children.concat(next.children);
          blocks.splice(idx + 1, 1);
          caret = { idx: idx, itemIdx: itemIdx, off: ol };
        } else if (next.kind === 'list') {
          list.items = list.items.concat(next.items);
          blocks.splice(idx + 1, 1);
          caret = { idx: idx, itemIdx: itemIdx, off: MD.inlineTextLen(item.children) };
        } else {
          caret = { idx: idx, itemIdx: itemIdx, off: MD.inlineTextLen(item.children) };
        }
      } else {
        caret = { idx: idx, itemIdx: itemIdx, off: MD.inlineTextLen(item.children) };
      }
    } else {
      var b = blocks[idx];
      if (idx >= blocks.length - 1) {
        caret = endOfBlock(blocks, idx);
      } else {
        var next2 = blocks[idx + 1];
        if (next2.kind === 'hr') {
          blocks.splice(idx + 1, 1);
          caret = endOfBlock(blocks, idx);
        } else if (MD.blockEmpty(b)) {
          blocks.splice(idx, 1);
          caret = startOfBlock(blocks, idx);
        } else if ((b.kind === 'paragraph' || b.kind === 'heading') && (next2.kind === 'paragraph' || next2.kind === 'heading')) {
          var bl = MD.inlineTextLen(b.children);
          b.children = b.children.concat(next2.children);
          blocks.splice(idx + 1, 1);
          caret = { idx: idx, off: bl };
        } else if (b.kind === 'list' && (next2.kind === 'paragraph' || next2.kind === 'heading')) {
          var lastItem2 = b.items[b.items.length - 1];
          var li2 = MD.inlineTextLen(lastItem2.children);
          lastItem2.children = lastItem2.children.concat(next2.children);
          blocks.splice(idx + 1, 1);
          caret = { idx: idx, itemIdx: b.items.length - 1, off: li2 };
        } else if ((b.kind === 'paragraph' || b.kind === 'heading') && next2.kind === 'list') {
          var fl2 = MD.inlineTextLen(next2.items[0].children);
          b.children = b.children.concat(next2.items[0].children);
          next2.items.shift();
          if (next2.items.length === 0) blocks.splice(idx + 1, 1);
          caret = { idx: idx, off: MD.inlineTextLen(b.children) - fl2 };
        } else if (b.kind === 'list' && next2.kind === 'list') {
          b.items = b.items.concat(next2.items);
          blocks.splice(idx + 1, 1);
          caret = endOfBlock(blocks, idx);
        } else {
          caret = endOfBlock(blocks, idx);
        }
      }
    }
    return { blocks: blocks, caret: caret };
  }

  function startOfBlock(blocks, i) {
    if (i < 0 || i >= blocks.length) return { idx: Math.max(0, Math.min(i, blocks.length - 1)), off: 0 };
    var b = blocks[i];
    if (b.kind === 'list') return { idx: i, itemIdx: 0, off: 0 };
    return { idx: i, off: 0 };
  }

  /**
   * 在块内偏移处插入文本（粘贴/输入法组合提交用）。
   */
  function insertTextInBlock(blocks, idx, itemIdx, off, text) {
    var lines = String(text).replace(/\r\n/g, '\n').split('\n');
    var ins = [];
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) ins.push({ kind: 'softbreak' });
      ins = ins.concat(MD.parseInlines(lines[i]));
    }
    var len = MD.inlineTextLen(ins);
    var caret;
    var b = blocks[idx];
    if (itemIdx >= 0 || (b && b.kind === 'list')) {
      var item;
      if (itemIdx >= 0) {
        item = b.items[itemIdx];
      } else {
        itemIdx = b.items.length - 1;
        item = b.items[itemIdx];
      }
      item.children = MD.insertIntoInlines(item.children, off, ins);
      caret = { idx: idx, itemIdx: itemIdx, off: off + len };
    } else {
      if (b.kind === 'code') {
        b.text = b.text.slice(0, off) + text + b.text.slice(off);
        caret = { idx: idx, off: off + text.length };
      } else {
        b.children = MD.insertIntoInlines(b.children, off, ins);
        caret = { idx: idx, off: off + len };
      }
    }
    return { blocks: blocks, caret: caret };
  }

  /**
   * 块类型归一化（输入后调用）：
   * 段落行首出现语法标记 → 转为标题/引用/列表（合并相邻同类列表）；
   * 列表项内误输入的列表标记 → 剥除。
   */
  function normalizeBlock(blocks, idx) {
    var b = blocks[idx];
    if (!b) return false;
    if (b.kind === 'paragraph') {
      var mk = MD.leadingMarker(b.children);
      if (!mk) return false;
      var stripped = MD.stripMarker(b.children, mk);
      if (mk.type === 'heading') {
        blocks[idx] = { kind: 'heading', level: mk.level, children: stripped };
        return true;
      }
      if (mk.type === 'quote') {
        blocks[idx] = { kind: 'quote', children: stripped };
        return true;
      }
      var item = { kind: 'listitem', children: stripped };
      var prev = idx > 0 ? blocks[idx - 1] : null;
      var next = idx < blocks.length - 1 ? blocks[idx + 1] : null;
      var prevList = prev && prev.kind === 'list' && prev.ordered === mk.ordered ? prev : null;
      var nextList = next && next.kind === 'list' && next.ordered === mk.ordered ? next : null;
      if (prevList && nextList) {
        prevList.items.push(item);
        prevList.items = prevList.items.concat(nextList.items);
        blocks.splice(idx, 2);
      } else if (prevList) {
        prevList.items.push(item);
        blocks.splice(idx, 1);
      } else if (nextList) {
        nextList.items.unshift(item);
        blocks.splice(idx, 1);
      } else {
        blocks[idx] = { kind: 'list', ordered: mk.ordered, items: [item] };
      }
      return true;
    }
    if (b.kind === 'list') {
      var changed = false;
      for (var i = 0; i < b.items.length; i++) {
        var im = MD.leadingMarker(b.items[i].children);
        if (im && im.type === 'list') {
          b.items[i].children = MD.stripMarker(b.items[i].children, im);
          changed = true;
        }
      }
      return changed;
    }
    return false;
  }

  window.EditorOps = {
    enterInBlock: enterInBlock,
    backspaceAtStart: backspaceAtStart,
    deleteAtEnd: deleteAtEnd,
    insertTextInBlock: insertTextInBlock,
    normalizeBlock: normalizeBlock,
    endOfBlock: endOfBlock
  };
})();
