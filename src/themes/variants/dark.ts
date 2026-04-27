/**
 * L2 Variant: dark
 *
 * 将 L1 原始值映射为 IRoles 语义角色。
 * 此文件是本系统中唯一允许 import primitives 的地方（variants/ 目录）。
 */
import { P } from '../primitives';
import type { IRoles } from '../types';

export const dark: IRoles = {

    surface: {
        app: P.n980,   // #08090a  Woodsmoke bg-0 / 画布
        chrome: P.n850,   // #1c1c1f  Woodsmoke bg-1 / Chrome
        activity: P.n850,   // #1c1c1f  左侧图标栏 / 活动轨
        sidebar: P.n850,   // #1c1c1f  侧边栏/主面板
        editor: P.n860,   // #1a1b1e  代码编辑区
        editorGutter: P.n860,   // #1a1b1e  编辑器装订线
        editorWidget: P.n840,   // #222326  悬浮 Widget / 补全框
        panel: P.n850,   // #1c1c1f  底部面板
        panelDepth: P.n840,   // #222326  面板次级
        tabbar: P.n850,   // #1c1c1f  Tab 栏
        tabActive: P.n860,   // #1a1b1e  活动 Tab 对齐编辑区
        tabHover: P.wa05,   // 5% white  悬浮 Tab
        overlay: P.n755,   // #35363a  高对比浮层
        overlayDepth: P.n795,   // #2b2c30  菜单内分组头/控件面
        hover: P.wa05,   // 5% white
        soft: P.wa04,   // rgba(255,255,255,.04)
        softStrong: P.wa12,   // 12% white
        selection: P.wa075,   // 7.5% white
    },

    text: {
        primary: P.n020,    // #f3f4f6
        secondary: P.n440,    // #c9ced8
        tertiary: P.n480,    // #949aa6
        quaternary: P.n380,    // #656b76
        onAccent: P.n060,    // #f8fafc
        placeholder: P.n380,    // #656b76
    },

    border: {
        subtle: P.wa06,  // rgba(255,255,255,.06)
        strong: P.wa10,  // rgba(255,255,255,.10)
        divider: P.wa08,  // rgba(255,255,255,.08)
    },

    accent: {
        default: P.a700,  // #5e6ad2
        strong: P.a600,  // #6f7cff
        muted: P.aa16,  // rgba(94,106,210,.16)
        soft: P.aa35,  // rgba(94,106,210,.35)
        statusbar: P.a800,  // #4c6fff
    },

    status: {
        success: P.g600,                        // #22c55e
        successMuted: 'rgba(34, 197, 94, 0.14)',
        warning: P.y400,                        // #f3c969
        warningMuted: 'rgba(243, 201, 105, 0.14)',
        danger: P.r500,                        // #ff6b7a
        dangerMuted: 'rgba(255, 107, 122, 0.16)',
        info: P.a600,                        // #6f7cff
        infoMuted: P.aa16,
    },

    syntax: {
        comment: P.n560,  // #4d5166
        keyword: P.v500,  // #c4b5fd
        string: P.g300,  // #86efac
        number: P.r200,  // #fca5a5
        delimiter: P.n505,  // #737780
        variable: P.y500,  // #fcd34d
        type: P.c600,  // #7dd3fc
        operator: P.n460,  // #a0a7b0
        cursor: P.v400,  // #a78bfa
        lineNumber: P.n600,  // #383c44
        lineNumberActive: P.n430,  // #cccdd8
    },

    diff: {
        modified: P.a500,  // #7c89ff
        added: P.g300,  // #86efac
        deleted: P.r600,  // #fb7185
        addedSubtle: 'rgba(134, 239, 172, 0.12)',
        deletedSubtle: 'rgba(251, 113, 133, 0.12)',
        modifiedSubtle: 'rgba(124, 137, 255, 0.12)',
    },

    terminal: {
        background: P.n860,                          // #1a1b1e
        foreground: P.n410,                          // #d7dce5
        cursor: P.a900,                          // #335cff
        cursorAccent: P.n860,
        selectionBackground: P.aa26,                          // rgba(94,106,210,.26)
        scrollbarBackground: P.wa10,
        scrollbarHoverBackground: P.wa18,
        scrollbarActiveBackground: 'rgba(124, 137, 255, 0.34)',
        black: P.n910,   // #111318
        red: P.r400,   // #ff7b88
        green: P.g500,   // #5dd39e
        yellow: P.y400,   // #f3c969
        blue: P.a500,   // #7c89ff
        magenta: P.p600,   // #c792ea
        cyan: P.c500,   // #89ddff
        white: P.n410,   // #d7dce5
        brightBlack: P.n380,   // #656b76
        brightRed: P.r300,   // #ff9aa5
        brightGreen: P.g400,   // #74e2ad
        brightYellow: P.y300,   // #f8d88b
        brightBlue: P.a400,   // #9aa6ff
        brightMagenta: P.p400,   // #d7a6ff
        brightCyan: P.c400,   // #a9e7ff
        brightWhite: P.n090,   // #f5f7fb
    },
};
