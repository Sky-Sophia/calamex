import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';

"use strict";
const demoAgent = new Agent({
  id: "demo-agent",
  name: "\u6211\u7684\u7B2C\u4E00\u4E2A\u52A9\u624B",
  instructions: "\u4F60\u662F\u4E00\u4E2A\u53CB\u597D\u3001\u4E50\u4E8E\u52A9\u4EBA\u7684\u52A9\u624B\uFF0C\u4F1A\u56DE\u7B54\u7528\u6237\u7684\u6240\u6709\u95EE\u9898\u3002",
  model: "openai/gpt-3.5-turbo"
});
const mastra = new Mastra({});
const agents = {
  demoAgent
};

export { agents, mastra as default, mastra };
