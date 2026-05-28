import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';

// 1. 定义 Agent
const demoAgent = new Agent({
    id: 'demo-agent',
    name: '我的第一个助手',
    instructions: '你是一个友好、乐于助人的助手，会回答用户的所有问题。',
    model: 'openai/gpt-3.5-turbo',
});

// 2. 初始化 Mastra 实例（不配置 storage，使用默认实现）
const mastra = new Mastra({});

// 3. 导出 agents（Studio 识别的标准方式）
export const agents = {
    demoAgent,
};

// 4. 必须同时导出命名变量和默认变量
export { mastra };
export default mastra;