// scripts/fix-ai-provider-settings.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const LB = '\u007b\u007b'; // 左双花括号
const RB = '\u007d\u007d'; // 右双花括号
const br = (e) => LB + ' ' + e + ' ' + RB;

const file = 'src/components/business/ai/provider/AiProviderSettings.vue';
let src = readFileSync(file, 'utf8');

const fixes = [
    [/pane === 'form' \? '编辑凭证' : 'AI 凭证'/, br("pane === 'form' ? '编辑凭证' : 'AI 凭证'")],
    [/<span class="ai-credential-group__name"> row\.preset\.label <\/span>/, '<span class="ai-credential-group__name">' + br('row.preset.label') + '</span>'],
    [/<span> row\.alias <\/span>/, '<span>' + br('row.alias') + '</span>'],
    [/row\.preset\.id\s+\/\s+row\.keyPreview/, br('row.preset.id') + ' / ' + br('row.keyPreview')],
    [/<TooltipContent> row\.hasCredentials \? '编辑' : '添加' <\/TooltipContent>/, '<TooltipContent>' + br("row.hasCredentials ? '编辑' : '添加'") + '</TooltipContent>'],
    [/providerRows\.length \? '没有匹配的凭证' : '还没有 AI 凭证'/, br("providerRows.length ? '没有匹配的凭证' : '还没有 AI 凭证'")],
    [/providerRows\.length \? '换个关键词再试试' : '点击右上角添加厂商 Key'/, br("providerRows.length ? '换个关键词再试试' : '点击右上角添加厂商 Key'")],
    [/<span> selectedProvider\.label <\/span>/, '<span>' + br('selectedProvider.label') + '</span>'],
    [/<span> provider\.label <\/span>/, '<span>' + br('provider.label') + '</span>'],
    [/<p v-if="aliasError" class="ai-credential-field-msg is-error"> aliasError <\/p>/, '<p v-if="aliasError" class="ai-credential-field-msg is-error">' + br('aliasError') + '</p>'],
    [/selectedProviderHasCredentials \? '留空则不修改已保存 Key' : '按厂商保存'/, br("selectedProviderHasCredentials ? '留空则不修改已保存 Key' : '按厂商保存'")],
    [/providerKeyError \|\| '本地加密保存，不会上传。'/, br("providerKeyError || '本地加密保存，不会上传。'")],
    [/<span> selectedSmallModel\.label <\/span>/, '<span>' + br('selectedSmallModel.label') + '</span>'],
    [/<span> model\.label <\/span>/, '<span>' + br('model.label') + '</span>'],
    [/<p v-if="tavilyKeyError" class="ai-credential-field-msg is-error"> tavilyKeyError <\/p>/, '<p v-if="tavilyKeyError" class="ai-credential-field-msg is-error">' + br('tavilyKeyError') + '</p>'],
    [/isSaving \? '保存中' : '保存'/, br("isSaving ? '保存中' : '保存'")],
    [/<span> feedbackText <\/span>/g, '<span>' + br('feedbackText') + '</span>'],
];

let ok = 0;
for (const [pattern, replacement] of fixes) {
    const before = src;
    src = src.replace(pattern, replacement);
    if (src !== before) ok += 1;
    else console.warn('未匹配:', pattern.toString());
}

writeFileSync(file, src, 'utf8');
console.log('完成：应用 ' + ok + '/' + fixes.length + ' 处修复');