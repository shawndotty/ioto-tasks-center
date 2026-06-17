# IOTO Tasks Center

English: [README.md](README.md)

完整指南： [docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md)

IOTO Tasks Center 是一个面向 Obsidian 的项目化任务管理插件。它提供 **任务中心** 和 **项目中心** 两个核心视图，同时保持所有任务都以普通 Markdown 笔记的形式存放在你的 Vault 中。

## 版本信息

- 当前版本：`2.1.1`
- 发布时间：`2026-06-15`
- 最低支持版本：`1.1.0`
- 平台兼容性：桌面端与移动端
- 发布页：[GitHub Releases](https://github.com/shawndotty/ioto-tasks-center/releases)

## 为什么使用它

- 任务仍然是普通 Markdown 文件
- 按项目文件夹组织任务
- 在不引入独立数据库的前提下，增加层级、元数据、搜索、预览与弹层导航
- 兼顾日常任务执行和项目级管理

## 功能亮点

- **任务中心**
  - 项目列表、任务列表、右侧预览、搜索、筛选、排序、分组
- **项目中心**
  - 以表格方式维护项目分类、日期、存档状态与任务数量
- **任务创建**
  - 四种任务类型：普通、日期、主题、计划
  - 支持按类型配置模板
  - 创建时可直接设置优先级和核心任务
- **层级管理**
  - 拖拽设置 `UpTask`
  - 右键创建子任务
  - 子任务折叠
  - 子任务数量 Badge 与 popover
- **洞察 Badge**
  - 状态 checklist popover
  - 输入 / 输出 / 成果出链 Badge 与 popover
  - 支持多彩配色或单色背景

## 2.1.1 更新重点

- 添加子任务改为原生 Sub Menu 风格
- 核心任务标签移到首位并设为默认
- `待开始` / `进行中` 状态新增未完成 checklist popover
- 创建任务时可直接设置优先级与核心任务
- 增加可选的子任务数量 Badge
- 增加链接类 Badge 的多彩 / 单色背景模式

## 快速开始

1. 创建任务根目录，例如 `3-任务/`
2. 在根目录下创建项目文件夹
3. 打开 **任务中心**
4. 创建任务或子任务
5. 在设置页中配置模板、出链根目录和 Badge 选项

示例结构：

```text
3-任务/
  项目 Alpha/
    Kickoff.md
    发布计划.md
```

## 安装

### 社区插件安装

1. 打开 **设置 → 社区插件**
2. 搜索 `IOTO Tasks Center`
3. 安装并启用

### 手动安装

将以下文件复制到 `<你的 Vault>/.obsidian/plugins/ioto-tasks-center/`：

- `main.js`
- `manifest.json`
- `styles.css`

然后重载 Obsidian 并启用插件。

## 文档导航

- 完整使用指南： [docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md)
- English full guide: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)
- English overview: [README.md](README.md)

完整指南包含：

- 文件组织方式
- frontmatter 字段
- 命令说明
- 完整设置项说明
- 使用示例
- 兼容性说明
- 常见问题排查
- 版本迭代记录

## 版本摘要

- `2.1.1`：任务列表交互增强、状态 checklist popover、子任务 Badge、Badge 配色模式
- `2.1.0`：子任务折叠、右键创建子任务、删除任务、搜索 popover
- `2.0.9`：项目中心、项目分类分组、核心任务支持、出链显示增强
- `2.0.8`：版本号对齐
- `1.0.0`：首次公开发布

## License

0-BSD
