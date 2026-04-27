/**
 * L2 Variant: light
 *
 * 将 L1 原始值映射为 IRoles 语义角色（浅色主题）。
 * 此文件是本系统中唯一允许 import primitives 的地方（variants/ 目录）。
 */
import { P } from '../primitives';
import type { IRoles } from '../types';

export const light: IRoles = {

    surface: {
        app: P.n100,   // #f3f5f8  应用根背景
        chrome: P.n080,   // #f6f7fb  标题栏/状态栏基调
        activity: P.n160,   // #edf1f8  活动轨
        sidebar: P.n070,   // #f7f9fc  侧边栏
        editor: P.n050,   // #ffffff  编辑器
        editorGutter: P.n060,   // #f8fafc  编辑器装订线
        editorWidget: P.n090,   // #f5f7fb  悬浮 Widget / 补全框
        panel: P.n090,   // #f5f7fb  底部面板
        panelDepth: P.n150,   // #eef2f8  面板次级
        tabbar: P.n100,   // #f3f5f8  Tab 栏
        tabActive: P.n050,   // #ffffff  活动 Tab
        tabHover: P.n150,   // #eef2f8  悬浮 Tab
        overlay: P.n090,   // #f5f7fb  菜单/下拉
        overlayDepth: P.n150,   // #eef2f8  菜单内分组头
        hover: P.ba06,   // rgba(15,23,42,.06)
        soft: P.ba04,   // rgba(15,23,42,.04)
        softStrong: P.ba08,   // rgba(15,23,42,.08)
        selection: P.n150,   // #eef2f8
    },

    text: {
        primary: P.n370,    // #111827
        secondary: P.n390,    // #334155
        tertiary: P.n510,    // #64748b
        quaternary: P.n470,    // #94a3b8
        onAccent: P.n050,    // #ffffff
        placeholder: P.n470,    // #94a3b8
    },

    border: {
        subtle: P.ba08,  // rgba(15,23,42,.08)
        strong: P.ba14,  // rgba(15,23,42,.14)
        divider: P.ba12,  // rgba(15,23,42,.12)
    },

    accent: {
        default: P.a700,                      // #5e6ad2
        strong: P.a900,                      // #335cff
        muted: 'rgba(76, 111, 255, 0.14)',
        soft: 'rgba(76, 111, 255, 0.22)',
        statusbar: P.a900,                      // #335cff
    },

    status: {
        success: P.g700,                       // #16a34a
        successMuted: 'rgba(22, 163, 74, 0.12)',
        warning: '#d4a72c',
        warningMuted: 'rgba(212, 167, 44, 0.12)',
        danger: P.r800,                       // #d92d4f
        dangerMuted: 'rgba(217, 45, 79, 0.10)',
        info: P.a900,                       // #335cff
        infoMuted: 'rgba(51, 92, 255, 0.10)',
    },

    syntax: {
        comment: P.n510,  // #64748b
        keyword: P.a900,  // #335cff
        string: P.g800,  // #15803d
        number: P.y700,  // #a16207
        delimiter: P.n390,  // #334155
        variable: P.y700,  // #a16207
        type: P.c800,  // #0f766e
        operator: P.n390,  // #334155
        cursor: P.a900,  // #335cff
        lineNumber: P.n470,  // #94a3b8
        lineNumberActive: P.n390,  // #334155
    },

    diff: {
        modified: P.a900,                       // #335cff
        added: P.g700,                       // #16a34a
        deleted: P.r700,                       // #e11d48
        addedSubtle: 'rgba(22, 163, 74, 0.10)',
        deletedSubtle: 'rgba(225, 29, 72, 0.10)',
        modifiedSubtle: 'rgba(51, 92, 255, 0.10)',
    },

    terminal: {
        background: P.n090,                          // #f5f7fb
        foreground: P.n370,                          // #111827
        cursor: P.a900,                          // #335cff
        cursorAccent: P.n090,
        selectionBackground: 'rgba(76, 111, 255, 0.18)',
        scrollbarBackground: P.ba12,
        scrollbarHoverBackground: P.ba22,
        scrollbarActiveBackground: 'rgba(51, 92, 255, 0.32)',
        black: P.n890,   // #15181d
        red: P.r900,   // #c2415b
        green: P.g800,   // #15803d
        yellow: P.y700,   // #a16207
        blue: P.a900,   // #335cff
        magenta: P.v600,   // #7c3aed
        cyan: P.c800,   // #0f766e
        white: P.n580,   // #475569
        brightBlack: P.n510,   // #64748b
        brightRed: P.r700,   // #e11d48
        brightGreen: P.g700,   // #16a34a
        brightYellow: P.y600,   // #ca8a04
        brightBlue: P.p900,   // #4f46e5
        brightMagenta: P.p800,   // #9333ea
        brightCyan: P.c700,   // #0891b2
        brightWhite: '#0f172a',
    },
};
