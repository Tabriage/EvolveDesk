# Evolve Desk

一个可配置、可审阅、能通过内置 Agent 持续进化的个人工作台。

项目主页：[github.com/Tabriage/EvolveDesk](https://github.com/Tabriage/EvolveDesk)

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，在右上角连接设置里输入本地 OpenAI 兼容服务地址和密钥。密钥只保留在当前页面内存中，不写入代码或浏览器存储。

## 当前安全边界

- 只允许连接本机 HTTP 模型服务（localhost / 127.0.0.1）。
- Agent 生成结构化能力提案，不执行终端命令。
- 所有改变先预览、后确认，可随时停用。
- 模块配置只保存在当前浏览器的 localStorage。

下一阶段可以加入受限文件补丁沙箱、Git 快照和逐文件变更审阅，让 Agent 在明确授权后安全地修改工作台源代码。
