import { describe, expect, test } from 'vitest';
import { describeScript } from '../src/discover.js';

describe('describeScript —— 脚本标题提取', () => {
  test('跳过 shebang，取真正的第一句注释（曾经的线上缺陷：描述全是 #!/usr/bin/env node）', () => {
    const src = [
      '#!/usr/bin/env node',
      '// 把草稿推到 X（Twitter），走 CDP 直连已登录窗口',
      "import { connect } from 'node:net';",
    ].join('\n');
    const d = describeScript(src, 'twitter-poster');
    expect(d).toBe('把草稿推到 X（Twitter），走 CDP 直连已登录窗口');
    expect(d.startsWith('#!')).toBe(false);
  });

  test('python 的 shebang + 编码声明不会成为描述', () => {
    const src = [
      '#!/usr/bin/env python3',
      '# -*- coding: utf-8 -*-',
      '# 小红书笔记采集：翻页抓取标题与互动数',
      'import json',
    ].join('\n');
    expect(describeScript(src, 'xhs-collect')).toBe('小红书笔记采集：翻页抓取标题与互动数');
  });

  test('块注释能剥掉首尾装饰', () => {
    const src = ['#!/bin/bash', '/**', ' * 每周巡检并汇总周报', ' */', 'set -e'].join('\n');
    expect(describeScript(src, 'xhs-weekly')).toBe('每周巡检并汇总周报');
  });

  test('优先中文注释（人写的意图比 license 头更值得展示）', () => {
    const src = ['#!/usr/bin/env node', '// Copyright 2024', '// 采集猫球账号的全部笔记'].join('\n');
    expect(describeScript(src, 'x')).toBe('采集猫球账号的全部笔记');
  });

  test('没有任何可用注释时回落到文件名，不返回空串', () => {
    expect(describeScript('#!/usr/bin/env node\nconst a = 1;', 'mystery')).toBe('mystery');
    expect(describeScript('', 'mystery')).toBe('mystery');
  });

  test('过短的行（>=4 字才算人话）被忽略，避免 // ok 之流', () => {
    const src = ['#!/usr/bin/env node', '// ok', '// 抓取指定账号的公开笔记列表'].join('\n');
    expect(describeScript(src, 'f')).toBe('抓取指定账号的公开笔记列表');
  });
});

describe('describeScript —— python docstring', () => {
  test('三引号 docstring 的正文被取出，且不再串到函数内的注释', () => {
    const src = [
      '#!/usr/bin/env python3',
      '"""',
      '小红书多账号数据采集 v2 — cookie 校验 + 双路径采集 + 批量',
      '',
      '采集路径:',
      '  凭据：浏览器既有登录态。',
      '"""',
      '',
      'def get_cookies():',
      '    # keyring 只是遗留 cookie 路径的依赖（见说明）',
      '    pass',
    ].join('\n');
    expect(describeScript(src, 'xhs-collect')).toBe('小红书多账号数据采集 v2 — cookie 校验 + 双路径采集 + 批量');
  });

  test('单行 docstring 可用', () => {
    const src = ['#!/usr/bin/env python3', '"""把榜单同步到 R2。"""', 'import os'].join('\n');
    expect(describeScript(src, 'sync')).toBe('把榜单同步到 R2。');
  });
});

describe('describeScript —— 不要把代码当注释', () => {
  test('shell case 分支（* 开头）不算描述，真标题是头部注释', () => {
    const src = [
      '#!/usr/bin/env bash',
      '# cover-gen.sh — 只做出图：museav CLI。不推飞书、不写台账。',
      'set -euo pipefail',
      'case "$1" in',
      '  *) echo "未知参数: $1" >&2; exit 1 ;;',
      'esac',
    ].join('\n');
    expect(describeScript(src, 'cover-gen')).toBe('cover-gen.sh — 只做出图：museav CLI。不推飞书、不写台账。');
  });

  test('C 风格解引用行不会被误认成 javadoc', () => {
    const src = ['#!/usr/bin/env node', '// 遍历 DOM 树', 'const n = *ptr;'].join('\n');
    expect(describeScript(src, 'walk')).toBe('遍历 DOM 树');
  });
});
