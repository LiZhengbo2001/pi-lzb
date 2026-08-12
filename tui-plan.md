# 备用屏幕布局系统方案

## 目的

为 `TuiAltScreen` 实现一个受限布局系统，并用它来保持 coding-agent 的对话记录可滚动，同时将 pending/status/widget/editor/footer 区域固定在底部。

本文档是一份实现交接文档。它记录了设计讨论中做出的决策，除非实现过程中发现问题需要重新审视某个决策，否则应将其视为既定范围。

## 核心决策

1. 受限布局系统是备用屏幕的一项特性。
2. `TuiMainScreen` 保持其现有的终端滚动回溯渲染模型。
3. 交互模式使用两种不同的组合方式，但共享相同的组件实例和行为。
4. 最初公开的布局原语为：
   - `VStack`
   - `HStack`
   - `ScrollView`
   - 现有的 overlay（叠加层）
5. 具体帧的布局树是内部实现细节。API 使用者构建组件树，永远不需要直接操作布局盒子、矩形、命中检测节点或滚动祖先关系。
6. 每次请求渲染时重建内部布局树。不重建组件状态。
7. 依赖现有的叶子节点渲染缓存，特别是 `Markdown`、`Text`、`Image` 和 `Box`。最初不引入第二层框架级渲染缓存。
8. `Editor` 目前不缓存其渲染行，但它体积小且是活跃组件；预计这不会成为主要开销。
9. 保持 `interactive-mode.ts` 的修改声明式且最小化。布局、裁剪、滚动、命中检测和事件路由属于 `packages/tui` 的职责范围。
10. 鼠标滚轮支持是一项增强功能。可配置的键盘滚动必须始终可用。

## 为什么主屏幕和备用屏幕的布局不同

在主屏幕模式下，终端控制滚动。应用程序无法可靠地提供：

- 固定行
- 独立可滚动的嵌套区域
- 全高并排面板
- 对移入终端滚动回溯区域的内容进行可靠的鼠标命中检测
- 在不重放或清空滚动回溯的情况下，对屏幕外区域进行任意重绘

因此，不要假装在 `TuiMainScreen` 中存在相同的受限视口语义。

主屏幕交互模式保持为垂直渲染的文档：

```text
header（头部）
loaded resources（已加载资源）
chat（对话）
pending messages（待处理消息）
status（状态）
widgets above（上方小部件）
editor / replacement UI（编辑器 / 替换 UI）
widgets below（下方小部件）
footer（页脚）
```

备用屏幕交互模式变为：

```text
┌─────────────────────────────────────────────┐
│ 可滚动的对话记录                              │
│                                             │
│ header                                      │
│ loaded resources                            │
│ chat/messages/tool output                   │
│                                             │
├─────────────────────────────────────────────┤
│ pending messages                            │
│ working/retry/compaction status             │
│ widgets above editor                        │
│ editor or temporary replacement UI          │
│ widgets below editor                        │
│ footer                                      │
└─────────────────────────────────────────────┘
```

待处理消息和状态属于固定区域。在用户阅读旧输出时隐藏活跃队列/工作状态会令人困惑。

## 目标

### 首次实现必须满足的需求

- `TuiAltScreen` 中的受限根布局。
- 垂直和水平堆栈布局。
- 具有跟随末尾行为的垂直滚动。
- 固定的 coding-agent 停靠区域。
- 现有的鼠标滚轮和键盘对话记录滚动。
- 基于指针下方区域的滚轮路由。
- 嵌套滚动视图的滚动链接。
- 现有的 overlay 渲染必须继续正常工作。
- 现有的光标定位和输入法支持必须继续正常工作。
- 现有的超链接点击和鼠标文本选择必须继续正常工作。
- 对于对话记录用例，现有的 Kitty 图像行为不得回归。
- `TuiMainScreen` 的行为和输出顺序必须保持不变。
- 退出备用模式时仍必须打印完整的逻辑最终文档。

### 该设计未来可支持的用途

- 宽终端侧边栏。
- 独立可滚动的对话记录和侧边栏。
- 固定的顶部区域。
- 布局感知的 overlay。
- 滚动条和未读行指示器。
- 对话记录虚拟化。

## 首次实现的非目标

- 兼容 CSS 的 flexbox。
- 网格布局。
- 换行的 flex 行。
- 任意绝对定位；overlay 已经覆盖了此需求。
- 百分比尺寸，除非它自然地来自现有的尺寸工具。
- 虚拟化对话记录渲染。
- 增量布局树变更。
- 供自定义组件创建或修改内部布局节点的公开 API。
- 改造每个现有组件以理解高度约束。
- 给主屏幕模式提供虚假的固定或嵌套滚动语义。

## 公开 API

### 堆栈条目

垂直和水平堆栈使用统一的轴无关条目类型。

```ts
export interface StackEntryOptions {
	/** 在堆栈主轴上的初始尺寸。默认为 "auto"。 */
	basis?: number | "auto";
	/** 在剩余可用空间中的分配份额。默认为 0。 */
	grow?: number;
	/** 内容溢出时的相对收缩意愿。默认为 1。 */
	shrink?: number;
	/** 主轴上的最小分配尺寸。默认为 0。 */
	minSize?: number;
	/** 主轴上的最大分配尺寸。 */
	maxSize?: number;
	/** 根据视口尺寸条件性地省略此条目。 */
	visible?: (viewport: { width: number; height: number }) => boolean;
}

export interface StackEntry extends StackEntryOptions {
	component: Component;
}

export type StackChild = Component | StackEntry;

export interface StackOptions {
	gap?: number;
	align?: "stretch" | "start" | "center" | "end";
}
```

实现中使用显式字段。不要使用 TypeScript 参数属性，因为根配置的源代码必须在 Node strip-only 模式下保持可擦除。

### `VStack`

```ts
export class VStack implements Component {
	constructor(children?: StackChild[], options?: StackOptions);

	addChild(component: Component, options?: StackEntryOptions): void;
	removeChild(component: Component): void;
	clear(): void;
	invalidate(): void;
	render(width: number): string[];
}
```

行为：

- 公开的 `render(width)` 提供无界高度渲染，用于兼容性和调试。
- 受限行为由 `TuiAltScreen` 通过内部布局引擎内部调用。
- 子元素从上到下排列。
- `gap` 行仅出现在可见子元素之间。
- 交叉轴默认为 `stretch`。

### `HStack`

```ts
export class HStack implements Component {
	constructor(children?: StackChild[], options?: StackOptions);

	addChild(component: Component, options?: StackEntryOptions): void;
	removeChild(component: Component): void;
	clear(): void;
	invalidate(): void;
	render(width: number): string[];
}
```

行为：

- 子元素从左到右排列。
- 子元素宽度从 `basis`、`grow`、`shrink`、`minSize` 和 `maxSize` 中分配。
- 较短的子元素根据 `align` 进行填充。
- 使用现有的 ANSI 感知切片/合成工具来组合 ANSI 行。永远不要对终端列使用纯字符串长度或原始子字符串。
- 初始图像支持只需要保持当前的垂直对话记录行为。关于水平限制，请参见图像部分。

### `ScrollView`

```ts
export interface ScrollViewOptions {
	axis?: "vertical";
	/** 在定位在末尾时跟随内容增长。 */
	follow?: "none" | "end";
	/** 将此视图指定为全局滚动操作的回退目标。 */
	primary?: boolean;
	/** 将未使用的滚轮增量冒泡到外部滚动视图。 */
	overscroll?: "chain" | "contain";
	/** 预留给后续可见滚动条实现。 */
	scrollbar?: "hidden" | "auto" | "always";
}

export class ScrollView implements Component {
	constructor(component: Component, options?: ScrollViewOptions);

	get scrollTop(): number;
	get isFollowingEnd(): boolean;

	scrollBy(lines: number): number;
	scrollToStart(): void;
	scrollToEnd(): void;
	invalidate(): void;
	render(width: number): string[];
}
```

`scrollBy()` 返回未使用的增量，以便嵌套滚动可以链接：

```ts
const remaining = scrollView.scrollBy(delta);
```

示例：

- 请求 `+3`，移动了 `+3`：返回 `0`。
- 请求 `+3`，只剩一行：移动一行并返回 `+2`。
- 请求 `-3`，已在顶部：返回 `-3`。

行为：

- 在受限布局中，子元素以无界高度进行测量/渲染，并裁剪到分配的视口。
- 在公开的无界 `render(width)` 中，渲染完整的子元素。这对于最终文档输出和调试是必需的，而不是为了在主屏幕模式中模拟视口行为。
- `follow: "end"` 的行为类似于当前的 `TuiAltScreen.stickToBottom`：
  - 以跟随模式开始
  - 内容增长使视图保持在末尾
  - 从末尾滚开则禁用跟随模式
  - 到达或显式滚动到末尾则启用跟随模式
- 滚动必须请求一次渲染。
- 当视口高度变化时保留 `scrollTop`，除非正在跟随末尾。

### 视口能力

不要像主屏幕模式支持它们那样向每个 `TUI` 实现添加受限布局方法。

添加一个显式的能力接口：

```ts
export interface ViewportTUI extends TUI {
	setLayoutRoot(component: Component | undefined): void;
}

export function isViewportTUI(tui: TUI): tui is ViewportTUI;
```

`TuiAltScreen` 实现 `ViewportTUI`。`TuiMainScreen` 不实现。

类型守卫应测试一个稳定的能力标识，而不是依赖应用层的 `instanceof`。具体实现可以使用 symbol 或方法存在性检查。

当没有设置显式布局根时，`TuiAltScreen` 的行为必须与当前 `addChild()` 的用户保持兼容。将其现有子元素视为隐式主 `ScrollView` 中的隐式垂直堆叠文档。

## 内部布局 API

不要从 `packages/tui/src/index.ts` 导出这些类型。

建议模块：`packages/tui/src/layout.ts`。

```ts
interface LayoutConstraints {
	width: number;
	/** undefined 表示无界高度。 */
	height: number | undefined;
}

interface LayoutRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface LayoutBox {
	component: Component;
	rect: LayoutRect;
	clip: LayoutRect;
	children: LayoutBox[];
	parent?: LayoutBox;
	/** 叶子节点渲染的行。按引用保留返回的数组。 */
	lines?: readonly string[];
	/** 当此盒子表示 ScrollView 视口时存在。 */
	scrollView?: ScrollView;
	/** 命中检测时需要的 Z/层级排序。 */
	layer: number;
}

interface LayoutFrame {
	root: LayoutBox;
	width: number;
	height: number;
	lines: string[];
	primaryScrollView?: ScrollView;
}
```

具体形状在实现过程中可能会变化，但必须支持：

- 绘制可见的终端行
- 裁剪嵌套的子元素
- 从终端坐标进行命中检测
- 转换为组件本地坐标
- 遍历祖先
- 识别滚动祖先
- 定位光标标记
- 保留足够的映射用于选择和超链接

### 组件树与布局树

公开的组件树是长期存在的、有状态的：

```text
VStack
├─ ScrollView
│  └─ chat container
└─ dock VStack
   ├─ editor container
   └─ footer container
```

内部布局树是一个瞬时的帧快照：

```text
box root       rect 0,0,120,40
├─ scroll box  rect 0,0,120,31 clip 0,0,120,31
│  └─ content  rect 0,-85,120,116
└─ dock box    rect 0,31,120,9
```

为每个请求的帧重建布局树。在成功绘制后原子性地替换已提交的帧，以便输入始终基于最后显示的几何信息进行路由。

不要仅仅为了生成布局几何而修改组件状态，除非是有意的 `ScrollView` 夹紧/跟随状态。

## 渲染和缓存策略

### 重建几何，复用叶子行

一个新鲜的帧执行：

```ts
const nextLayout = layout(root, terminalBounds);
const nextScreen = paint(nextLayout);
writeScreenDiff(previousScreen, nextScreen);
currentLayout = nextLayout;
```

对于叶子组件：

```ts
const lines = component.render(width);
```

在布局盒子中按引用保留 `lines`。大多数昂贵的叶子节点已按内容和宽度进行缓存：

- `Markdown` 缓存文本、宽度和渲染的行。
- `Text` 缓存文本、宽度和渲染的行。
- `Image` 缓存宽度和渲染的行。
- `Box` 基于宽度/背景/子元素输出进行缓存。
- 几个 coding-agent 的动画和工具组件有自己的缓存。

`Editor`、`Input`、选择器、页脚和一些小叶子节点每次重新计算。最初这是可接受的。

在性能分析显示有必要之前，不要在布局引擎中添加单独的 `WeakMap<Component, RenderCache>`。第二层缓存有变得陈旧的风险，因为现有组件拥有自己的失效语义。

### 在可行的情况下避免不必要的展平

第一个正确的实现可以调用现有的 `Container.render(width)`，这会展平子元素数组。Markdown 解析/高亮仍将被缓存，所以这对初始实现来说是可接受的。

如果容易且安全，将精确的基本 `Container` 实例优化为结构化的垂直堆栈，这样布局就可以保留子元素行数组和高度，而无需展平整个对话记录。不要绕过 `Container` 子类（如消息/工具组件）中重写的渲染。将子类视为叶子节点，除非它们显式选择加入内部结构化布局。

不要将此优化作为正确性的前提条件。

### 不渲染则无布局

仅在 `requestRender()` 调度渲染后才重建布局帧。没有独立的布局循环。

## 堆栈布局算法

实现应使用一个由轴参数化的共享堆栈分配器。

### 可见性

1. 根据终端视口尺寸评估 `visible`。
2. 在计算间隙或尺寸分配之前移除不可见的条目。

### 固有尺寸

- `basis: "auto"` 使用子元素在主轴上的固有尺寸。
- 数值 `basis` 使用给定的单元格数量。
- 将 basis 夹紧到 `minSize`/`maxSize`。
- 对于换行的叶子节点，宽度分配必须在固有高度已知之前进行。
- 因此 `HStack` 在测量子元素高度之前分配宽度。
- `VStack` 在分配的宽度下渲染/测量 auto-height 子元素，然后再分配剩余高度。

### 正的剩余空间

将正的剩余空间在 `grow > 0` 的条目之间按比例分配，比例依据 `grow`，同时遵守 `maxSize`。

使用确定性的整数舍入。按子元素顺序分配剩余的单元格，使布局不会逐帧抖动。

### 溢出

当总 basis 超过可用空间时：

1. 计算可收缩的条目（`shrink > 0` 且当前尺寸高于 `minSize`）。
2. 按 `shrink` 和当前 basis 的比例分配所需的收缩量，或采用另一种确定性的、有文档说明的策略。
3. 如果某个条目在溢出解决之前达到 `minSize`，则重复该过程。
4. 如果约束仍然无法满足，则在父边界处裁剪。

聚焦的光标不能仅仅因为叶子被裁剪而消失。当垂直裁剪叶子且其行中包含 `CURSOR_MARKER` 时，在可能的情况下选择一个包含该标记的可见行窗口。

### 初始交互式布局尺寸

对话记录应该是弹性的，停靠区域应倾向于固有高度：

```ts
new VStack([
	{
		component: transcriptScrollView,
		basis: 0,
		grow: 1,
		shrink: 1,
		minSize: 1,
	},
	{
		component: dock,
		basis: "auto",
		grow: 0,
		shrink: 1,
		minSize: 1,
	},
]);
```

实现必须为非常小的终端和过大的自定义小部件定义合理的行为。优先顺序：

1. 当终端高度允许时，保留至少一行对话记录。
2. 保留聚焦的编辑器/选择器光标。
3. 在可能的情况下保留至少一行页脚。
4. 在隐藏聚焦的编辑器之前裁剪/截断小部件和 pending/status 内容。

这可能需要 coding-agent 特定的堆栈条目 `minSize`/`shrink` 设置，而不是向通用 TUI 布局添加特定领域的优先级规则。

## 绘制

### 帧表面

布局引擎可以继续使用每终端行的 ANSI 字符串，而不是引入完整的单元格对象模型。

绘制必须：

- 在受限备用模式下精确创建 `terminal.rows` 行基础行
- 遵守每个盒子的矩形和累积裁剪
- 使用 ANSI 感知的列切片
- 在独立绘制的区域之间重置样式
- 在提取光标之前保留 `CURSOR_MARKER`
- 组合水平子元素而不发生样式泄漏
- 产生的行宽度不超过终端宽度

复用：

- `sliceByColumn()`
- `compositeTuiLine()`
- `visibleWidth()`
- 现有的行重置规范化

### 垂直堆栈

在每个子元素的分配 `y` 处绘制。跳过不与累积裁剪相交的子元素和行范围。

### 水平堆栈

在每个子元素的分配 `x` 处绘制。在组合相邻子元素之前，将较短的行填充到分配的宽度。应用重置边界，以防止一个子元素的样式或 OSC 8 超链接泄漏到另一个子元素。

### 滚动视图

- 子元素内容以其完整自然高度进行布局。
- 子元素的绘制原点平移 `-scrollTop`。
- 将滚动视图的矩形累积到裁剪区域中。
- 仅绘制与视口相交的子元素行。
- 在布局树中记录滚动盒子，用于命中检测和祖先遍历。

## 输入和事件路由

### 规范化的鼠标事件

将终端鼠标解析保留在 `TuiAltScreen` 中，但在路由前将解析的序列转换为规范化事件：

```ts
interface TuiMouseEvent {
	type: "press" | "release" | "move" | "wheel";
	x: number;
	y: number;
	button: number;
	deltaX: number;
	deltaY: number;
}
```

此类型的具体公开可见性是可选的。初始的滚轮路由器可以保持为内部实现。

### 命中检测

对已提交的布局帧进行命中检测，而不是对当前正在构建的帧。

1. 拒绝位于其裁剪区域之外的盒子。
2. 首先遍历较高层级/最前面的子元素。
3. 返回包含终端坐标的最深可见盒子。
4. 保留祖先链用于事件冒泡。

### 滚轮路由

对于滚轮事件：

1. 在指针位置进行命中检测。
2. 从最深的盒子开始，向根节点遍历。
3. 将增量提供给每个遇到的 `ScrollView`。
4. 如果 `overscroll` 为 `"chain"`，将未使用的增量传递给下一个滚动祖先。
5. 如果 `overscroll` 为 `"contain"`，即使还有剩余增量也停止。
6. 如果没有命中祖先消耗该增量，则将其提供给帧的主滚动视图。
7. 消费已识别的鼠标序列，使原始鼠标字节永远不会到达编辑器。

预期行为：

- 在对话记录上滚轮：滚动对话记录。
- 在未来的侧边栏上滚轮：滚动侧边栏。
- 在嵌套滚动视图上滚轮：滚动内部视图，然后在其边界处链接。
- 在不可滚动的停靠区域/页脚上滚轮：滚动主对话记录。
- 滚轮交互不能从编辑器窃取键盘焦点。

### 触控板

保持当前忽略垂直滚动视图的水平滚轮事件的行为。如果事件同时包含两个轴，仅消费支持的垂直部分并记录该策略。

### 鼠标禁用回退

不要依赖检测鼠标支持。终端不提供足够可靠的通用能力信号。

键盘导航始终通过现有的可配置操作可用：

- `tui.altScreen.pageUp`
- `tui.altScreen.pageDown`
- `tui.altScreen.top`
- `tui.altScreen.bottom`

将这些操作路由到：

1. 一个显式活跃的滚动区域（如果未来的多面板导航设置了的话）
2. 否则路由到主滚动视图

对于第一个 coding-agent 布局，只有一个滚动视图，因此对话记录始终是键盘目标。

如果未来的布局引入了多个键盘可选择的滚动区域，则向 `TUI_KEYBINDINGS` 添加可配置操作；永远不要硬编码按键检查。

## 焦点和光标行为

- 现有的 `TUI.setFocus(component)` 仍然是公开的键盘焦点 API。
- 键盘焦点和滚轮滚动目标是分开的。滚动侧边栏不得将焦点从编辑器移开，除非显式请求。
- 在绘制期间，在最终组合帧中查找 `CURSOR_MARKER`。
- 光标行/列必须包括堆栈偏移、滚动平移、overlay 偏移和水平面板偏移。
- 仅根据现有的 `showHardwareCursor` 行为显示硬件光标。
- overlay 焦点恢复所使用的布局包容检查必须理解布局根和嵌套布局组件。

## 选择和超链接

当前的备用渲染器将选择行直接映射到一个全局逻辑文档中。一旦存在固定和水平区域，这个假设就不再成立。

对于首次实现，保留可见屏幕选择的语义：

- 锚点和焦点从终端屏幕坐标开始。
- 根据当前已提交的可见帧应用高亮。
- 使用 ANSI 感知切片和 `stripTerminalSequences()` 从选中的可见行/列复制文本。
- 空白/填充区域除了必要的行分隔外不贡献任何文本。
- 继续将选择列对齐到字形边界。

如果需要跨帧更改保持选择，则在绘制的行中存储足够的源映射，以将屏幕行转换为叶子行引用。不要将固定的停靠区域行映射到不相关的对话记录行。

超链接点击可以继续从已提交屏幕行在点击列读取 OSC 8 元数据。确保使用的是最终组合行，而不是未平移的子元素行。

保持当前行为：

- 不带拖动的点击可能调用 `openUrl`
- 拖动不会激活 URL
- 拖动后释放通过 OSC 52 复制

## 图像

最初需要的图像用例是现有的垂直滚动对话记录。

保留：

- Kitty 图像元数据和保留的行
- 当 Kitty 图像顶部在滚动视口上方时的裁剪
- 当包含图像的行改变时的删除/重绘
- 备用模式下 iTerm2 回退到文本

在首次实现中不需要使图像协议行的水平组合完全通用。终端图像放置的行为不像普通的 ANSI 文本。记录并防御性地处理这一限制：

- `HStack` 中带有图像的组件可能被要求占据完整的行/宽度
- 不要静默地破坏相邻面板的输出
- 为所选择的任何回退策略添加一个重点测试

不要使现有的垂直图像测试回归。

## Overlay（叠加层）

保持当前的 overlay 堆栈和定位 API。

初始集成：

1. 将基础受限布局绘制成终端高度的行。
2. 使用当前的 overlay 逻辑在这些行之上组合现有的 overlay。
3. 从最终结果中提取光标。
4. 应用差分渲染。

在首次实现中，不需要将现有的 overlay 变为嵌套的 `ScrollView` 布局根。然而，基础布局的命中检测不能破坏 overlay 的焦点或输入所有权。

后续阶段可以为每个 overlay 提供其自己的受限布局树，并将 overlay 盒子作为更高的命中检测层包含进来。

## `TuiAltScreen` 重构

变更后建议的状态：

```ts
private layoutRoot?: Component;
private currentLayout?: LayoutFrame;
private implicitScrollView?: ScrollView;
```

将这些职责从 `TuiAltScreen` 全局字段中移出，并在适用的情况下放入 `ScrollView`：

- `scrollTop`
- `contentLineCount`
- `stickToBottom`

兼容性的 getter/方法（如 `viewportTop`、`isFollowingOutput`、`scrollBy()`、`scrollToTop()` 和 `scrollToBottom()`）可以委托给主/隐式滚动视图，以便现有测试和使用者继续工作。不要为了向后兼容而显著复杂化实现，除非测试/公开 API 表明这些方法被依赖；在移除之前检查导出和使用情况。

`doRender()` 在概念上变为：

```ts
const root = this.layoutRoot ?? this.getImplicitLegacyRoot();
const nextLayout = layoutConstrained(root, width, height);
let screen = paint(nextLayout);
screen = this.compositeOverlays(screen, width, height);
screen = this.applySelection(screen);
const cursor = this.extractCursorPosition(screen, height);
// 规范化、裁剪防御性溢出、差分、写入。
this.currentLayout = nextLayout;
```

### 旧的隐式根

当调用者仅使用 `tui.addChild()` 时：

```text
隐式 ScrollView（primary，follow=end）
└─ TuiAltScreen.children 的隐式垂直文档
```

这保留了当前独立的 `TuiAltScreen` API 和测试。

隐式根必须观察后续的 `addChild()`、`removeChild()` 和 `clear()` 变更。

### 停止时的最终文档

当离开备用模式时，以无界高度渲染显式或隐式根：

- `ScrollView` 输出其完整的子元素，而不是裁剪后的视口。
- coding-agent 对话记录首先出现，停靠区域在其之后出现一次。
- 不打印终端高度的填充行。
- 剥离光标标记。
- 保留现有的行重置和图像清理。

不要仅使用最后一个可见帧作为退出文档。

## 交互模式变更

文件：`packages/coding-agent/src/modes/interactive/interactive-mode.ts`

变更应保持最小。

### 添加稳定的分组容器

```ts
private documentContainer: Container;
private footerContainer: Container;
```

现有的组件容器保持不变：

- `headerContainer`
- `loadedResourcesContainer`
- `chatContainer`
- `pendingMessagesContainer`
- `statusContainer`
- `widgetContainerAbove`
- `editorContainer`
- `widgetContainerBelow`

一次性构建对话记录分组：

```ts
this.documentContainer.addChild(this.headerContainer);
this.documentContainer.addChild(this.loadedResourcesContainer);
this.documentContainer.addChild(this.chatContainer);
```

一次性构建页脚槽位：

```ts
this.footerContainer.addChild(this.footer);
```

### 主屏幕组合

保持当前精确排序：

```ts
this.ui.addChild(this.documentContainer);
this.ui.addChild(this.pendingMessagesContainer);
this.ui.addChild(this.statusContainer);
this.ui.addChild(this.widgetContainerAbove);
this.ui.addChild(this.editorContainer);
this.ui.addChild(this.widgetContainerBelow);
this.ui.addChild(this.footerContainer);
```

因为 `documentContainer` 在视觉上是透明的，其三个子元素渲染的位置与今天完全相同。

### 备用屏幕组合

```ts
const transcript = new ScrollView(this.documentContainer, {
	follow: "end",
	primary: true,
	overscroll: "chain",
});

const dock = new VStack([
	{ component: this.pendingMessagesContainer, shrink: 1, minSize: 0 },
	{ component: this.statusContainer, shrink: 1, minSize: 0 },
	{ component: this.widgetContainerAbove, shrink: 1, minSize: 0 },
	{ component: this.editorContainer, shrink: 1, minSize: 3 },
	{ component: this.widgetContainerBelow, shrink: 1, minSize: 0 },
	{ component: this.footerContainer, shrink: 1, minSize: 1 },
]);

const root = new VStack([
	{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
	{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
]);

viewportTui.setLayoutRoot(root);
```

使用 `isViewportTUI(this.ui)` 进行类型收窄。由于 `options.alt` 选择了渲染器，无法获取该能力属于内部编程错误，而非静默回退。

### 自定义页脚替换

重构 `setExtensionFooter()`，使其永远不删除/添加根 TUI 子元素：

```ts
this.footerContainer.clear();
this.footerContainer.addChild(this.customFooter ?? this.footer);
this.ui.requestRender();
```

继续处理被替换的自定义页脚的销毁。

### 不应需要逻辑变更的功能

- 消息渲染
- 流式更新
- 工具更新
- 小部件 API
- 编辑器替换
- 扩展选择器/输入/编辑器
- 内置选择器
- 队列渲染
- 状态指示器
- 焦点变更
- overlay
- 主题失效

这些功能修改现有的稳定容器，应自动出现在正确的布局中。

### 现有的备用屏幕特定状态处理

重新审视此代码：

```ts
if (hadActiveStatusIndicator && !this.options.alt && this.ui.getClearOnShrink()) {
	this.statusContainer.addChild(this.idleStatus);
}
```

主屏幕的变通方案应保持仅适用于主屏幕。受限备用布局应自然地清除释放的行。

## 建议的文件

可能的新文件：

- `packages/tui/src/layout.ts` — 内部约束、盒子、布局、绘制、命中检测
- `packages/tui/src/components/v-stack.ts`
- `packages/tui/src/components/h-stack.ts`
- `packages/tui/src/components/scroll-view.ts`

可能修改的文件：

- `packages/tui/src/tui.ts`
- `packages/tui/src/tui-alt-screen.ts`
- `packages/tui/src/index.ts`
- `packages/tui/src/keybindings.ts` — 仅当需要新的可配置操作时
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`
- `packages/tui/test/tui-alt-screen.test.ts`
- `packages/tui/test/` 下的新重点布局测试
- `packages/coding-agent/test/interactive-tui.test.ts`
- `packages/tui/README.md`
- `packages/coding-agent/docs/usage.md`
- `packages/coding-agent/docs/keybindings.md` — 如果键盘行为有变更
- `packages/tui/CHANGELOG.md`
- `packages/coding-agent/CHANGELOG.md`

不要修改已发布的 changelog 部分。在现有的 `## [Unreleased]` 子部分下添加条目。

## 测试计划

### 堆栈分配测试

为两个轴添加重点单元测试：

- 自动尺寸的子元素
- 数值 basis
- 正的 grow 分配
- shrink 分配
- min/max 夹紧
- 确定性的奇数单元格舍入
- 仅在可见子元素之间的间隙
- 条件可见性
- 交叉轴对齐
- 宽度超过分配的子元素输出被安全裁剪
- ANSI 样式/超链接不会在水平子元素之间泄漏
- 水平裁剪中的 CJK、emoji 和组合字符边界

### ScrollView 测试

- 初始 `follow: "end"` 位置
- 跟随时的内容增长
- 手动向上滚动禁用跟随
- 到达底部重新启用跟随
- 显式 `scrollToEnd()` 重新启用跟随
- 跟随时视口增长/缩小
- 手动定位时视口增长/缩小
- `scrollBy()` 返回未使用的正/负增量
- 嵌套滚动链接
- `overscroll: "contain"`
- 子元素短于视口
- 空子元素
- 子元素宽度变化
- 当聚焦内容被裁剪时光标标记保持可见

### 布局帧测试

- 嵌套 V/H 堆栈生成的矩形
- 累积裁剪
- 命中检测返回最深可见盒子
- 被裁剪的盒子不可被命中检测
- 本地坐标转换
- 层级排序
- 仅绘制滚动视图中的可见行
- 每个帧在 resize/内容变更后使用全新的几何
- 缓存的叶子行数组按引用接受且不被修改

### 备用屏幕渲染器测试

扩展 `packages/tui/test/tui-alt-screen.test.ts`：

- 旧的 `addChild()` 路径仍像当前的隐式滚动一样工作
- 显式布局根渲染终端高度的帧
- 对话记录滚动时固定停靠区域保持不变
- 对话记录视口高度考虑停靠区域高度
- 跟随时停靠区域增长/缩小
- 手动滚动时停靠区域增长/缩小
- Shift+PageUp/Down 以主 ScrollView 为目标
- Ctrl+Home/End 以主 ScrollView 为目标
- 在对话记录上滚轮则滚动对话记录
- 在不可滚动的停靠区域上滚轮回退到主对话记录
- 嵌套滚动先消费并将未使用的增量冒泡
- 鼠标禁用模式仍支持键盘滚动
- 停靠区域内光标行正确
- 滚动内容内光标行正确
- overlay 组合保持屏幕相对
- overlay 焦点行为保持正确
- 水平和垂直偏移后 OSC 8 点击保持正确
- 选择/复制在对话记录中有效
- 选择/复制在停靠区域中有效，不映射到对话记录行
- 终端 resize 重新计算布局
- 过大的停靠区域不会丢失聚焦光标
- 停止时打印完整对话记录加停靠区域恰好一次
- 最终输出中没有终端填充行

保留并通过所有现有图像测试：

- Kitty 在视口顶部的裁剪
- 图像删除/重绘
- iTerm2 回退
- 没有陈旧的图像放置

### 主屏幕回归测试

- 现有主屏幕测试不变地通过
- 交互式主屏幕子元素顺序/渲染输出不变
- 自定义页脚在流中保持在底部
- 主屏幕模式下没有安装布局根或应用滚动

### Coding-agent 集成测试

在 `packages/coding-agent/test/interactive-tui.test.ts` 或新的重点测试中：

- 渲染器能力仅对备用模式暴露
- 主模式挂载流式组合
- 备用模式挂载对话记录 ScrollView 加停靠区域
- pending/status/widgets/editor/footer 在停靠区域中
- 自定义页脚替换更新 `footerContainer`
- 编辑器替换不重建根布局
- 小部件更新不重建公开的组件组合

优先检查组件组合或使用 `VirtualTerminal`；不要使用真实的 provider API。

## 验证命令

实现变更后：

1. 从相关包根目录使用仓库规定的 Vitest 调用方式运行每个修改/新增的重点测试。
2. 从仓库根运行 `npm run check`，修复所有错误、警告和信息。
3. 不要运行 `npm test` 或完整的 Vitest 套件。
4. 如果需要更广泛的验证，可选择使用仓库的 `./test.sh` 运行所有非 e2e 测试。
5. 使用 `AGENTS.md` 中的 tmux 过程手动测试备用模式：
   - 长对话记录
   - 滚轮/触控板滚动
   - Shift+PageUp/Down
   - 手动滚动时的流式更新
   - 返回底部/跟随
   - 多行编辑器
   - 自动补全打开
   - 设置/模型/树选择器替换编辑器
   - 编辑器上方和下方的扩展小部件
   - 自定义页脚
   - 终端 resize
   - 超链接点击
   - 鼠标选择/复制
   - Kitty 图像（如果可用）
6. 手动快速测试主屏幕模式，确保终端滚动回溯行为不变。

## 推荐实现顺序

1. 添加堆栈分配单元测试和共享轴分配器。
2. 实现 `VStack` 无界渲染和受限内部布局。
3. 实现 `HStack` 及 ANSI 安全的组合。
4. 实现 `ScrollView` 状态和独立于终端 ANSI 输出的单元测试。
5. 实现内部布局帧生成和绘制。
6. 添加命中检测和滚动祖先遍历。
7. 将显式和隐式布局根集成到 `TuiAltScreen` 中。
8. 将当前的全局备用滚动行为移到隐式主 `ScrollView` 兼容性路径后面。
9. 每次处理一个子系统，保留选择、超链接、光标、overlay 和图像处理，在每一步后运行现有测试。
10. 添加 coding-agent 分组容器和两个小型的组合分支。
11. 重构自定义页脚替换以使用 `footerContainer`。
12. 添加集成测试、文档和 changelog 条目。
13. 运行重点测试和 `npm run check`。
14. 在两种模式下执行 tmux/手动快速测试。

## 验收标准

实现完成的标志：

- 主屏幕模式行为如旧并保留终端滚动回溯。
- 备用屏幕模式具有可滚动的对话记录和固定的底部停靠区域。
- 流式输出仅在跟随模式活跃时跟随对话记录末尾。
- 新输出到达时手动滚动保持稳定。
- 鼠标滚轮路由到适当的滚动视图并在边界处链接。
- 键盘导航在鼠标禁用时可用。
- 编辑器/选择器焦点和输入法光标位置保持正确。
- 小部件和自定义页脚保持扩展兼容并在备用模式下固定。
- 超链接、选择、overlay 和 Kitty 对话记录图像不回归。
- 离开备用模式时恰好打印一次完整逻辑文档。
- 布局盒子是内部的，并在每个请求的帧时重建。
- 昂贵的叶子渲染继续使用现有的组件缓存。
- 所有重点测试和 `npm run check` 通过。
