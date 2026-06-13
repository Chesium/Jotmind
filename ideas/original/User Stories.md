[[Orbital]]
[A recipe for brainstorming user stories](https://nus-cs2113-ay2425s2.github.io/website/se-book-adapted/chapters/specifyingRequirements.html#a-recipe-for-brainstorming-user-stories)
## Step 1: Define the *target user* as a *persona*:
> Decide your target user's profile (e.g. a student, office worker, programmer, salesperson) and work patterns (e.g. Does he work in groups or alone? Does he share his computer with others?). A clear understanding of the target user will help when deciding the importance of a user story. You can even narrow it down to a _persona_.

Jean is a university student studying in a non-IT field. She interacts with a lot of people due to her involvement in university clubs/societies. ...

小明也是一个大学生，他很想拓展自己的人脉圈/巩固已有的人脉关系，但比较害羞，比较健忘，他对IT技术有一定了解

## Step 2: Define the *problem scope*:
> Decide the exact problem you are going to solve for the target user. It is also useful to specify what related problems it will _not_ solve so that the exact scope is clear.

Jotmind 会帮助小明整理各种信息，包括但不限于：
- ***人脉关系***
- 碎片化的日程、任务
- 每日感想、旅途中的所思所想
- ***各种平台工具（Apps、frameworks）***
- 书籍之间的关系
- 小说角色之间的关系
- 音乐曲调之间的关系

多种界面来查看/编辑上述信息

Jotmind 不会帮助小明获得新的人脉


每个用户会有一个 user -> knowledge base

base -> 多个 knowledge cluster 知识集群/知识蔟

knowledge cluster 

人脉 cluster

人、事
cluster对应一个类型的数据，在同一个图表里显示


cluster template的
- 人脉中我的联系人的关系图：view 视图 person
- 人脉中我的联系人的列表：view
- 人脉中我和我的联系人经历的事件：时间轴：view 视图

各种平台工具
- 列表 table view
- 关系图 network view
- timeline view


cluster ---- view
记录人脉场景下

人脉 connection module
- people cluster
	- network view: default
	- tree view
	- table view

各种平台工具论文学术概念 concept module
- concept cluster
	- table view

日程
- event cluster
	- timeline view: default
		- filter: 时间段、参与的人......
	- table view

健身 workout module
- 每次健身 workoutSession
	- timeline view
- 每个动作组
- 健身动作 exercise（static cluster）
	- table view
	- card view

base > cluster
每个cluster会包含一些*对象属性*

view
- 点开一个节点，显示一个panel让用户可以更改/添加/删除properties
- network
	- 多选节点，添加group，添加event
- timeline
- table
  
Search & Edit Feature
输入自然语言，显示多种可能的搜索/修改指令，用户选择一个执行操作
显示的指令应该是格式化的，

修改【....节点】的【...属性】为【...】
添加

让llm直接产生结构化的数据：json

“清华” ---> “*【问题阐述】【目前的数据】你认为用户输入的“清华”意思是什么指令，请按【...格式】输出可能的指令结果*”--->json--->解析--->在前端显示出来--->用户重新提问或选择一个指令执行

（全文搜索）寻找所有属性/名称里包含清华的人物或事件或工具
（llm负责分段补全的功能，类似copilot）

清华->清华大学->【学校】属性为【清华大学】的【人物】

```json
{
	"type":"propertyIs", //"...属性为...的..."
	"cluster":"People",
	"key":"school",
	"value":"TsingHua University"
}
```

- 【学校】属性为【清华大学】的【人物】
- 【学校】属性包含【清华】的【人物】

修改：高亮修改后的部分

查询：高亮结果/用户在各个查询结果中跳转


1. 用户创建账号，他有自己的知识库knowledge base，是空的
2. 用户决定在上面记录人脉
	1. 展示一批示例数据，用户位于network view-
3. 用户决定在上面记录各种平台工具

- 关系图：联系人、各种平台工具
- 列表：联系人、各种平台工具、事件、啥都行






## Step 3: List *scenarios* to form a *narrative*:
> Think of the various scenarios your target user is likely to go through as she uses your app. Following a chronological sequence as if you are telling a story might be helpful.

### A. First use

小明发现这个软件，希望能看看它能如何帮助自己整理各种信息，并形成知识库
App一开始的教程要向小明展示一批示例数据并引导小明试用平台的核心功能，同时也要有一个快捷的方式在新手教程后还能查询到各个功能的用法（文档）

新手教程需要介绍该软件的各个用户层概念（与插件开发者所需的开发层概念所区分开），包括：
- 每个账户有一个属于自己的知识库 knowledge base，你可以在里面记录任何碎片化或成体系的信息
- 随着我们往知识库里添加信息，jotmind平台会通过不同的视图（view）来可视化这些信息之间的关联，比如人际关系会被显示成一个网络，旅游时的所思所想会被列在一个时间轴上
- 所有这些信息都被存在唯一的知识库中，但单个视图只会显示一类信息，根据信息所属的大类知识库会被分成多个知识集群/知识蔟 knowledge cluster，比如你的人脉构成一个cluster，你知道的科研小工具构成另一个cluster
- 每个cluster对应一个cluster template组件（目前好像创建多个同template的cluster没有意义？）
-  不过虽然一个view中只会显示一个cluster中所有信息的关系，但是在信息详情中你也会看到cluster与cluster之间存在的关系（比如我的人脉和我参与的社交活动之间的关系，“我在ICRA2025上认识了John”就是一个inter-cluster relationship），在视图中点击这些关系一般会让你跳转到另一个cluster所对应的view中
- 想要编辑知识库里的内容，有两种方法：
	- 直接在某个view中点开你想要修改的部分并直接输入修改值
	- 使用语音或自然语言在*统一命令接口*（universal command interface）告知修改需求，系统会通过RAG技术连接LLM解析用户指令，并给出格式化的解析结果（如“Simon上个月搬家到了Shanghai”会被解析为“修改\<人物\>Simon的\<place_of_living\>属性为\<Shanghai\>；添加\<事件\>...”
- 接着我们介绍目前阶段下jotmind平台内置的cluster template
	- 人物 Person cluster 和事件 Event cluster
		- Person cluster 的默认view的名字是Connection Network（开发层：继承自network view），另外还有一个Connection Table（table view）和Connection Stats（statistics view）
		- Event cluster 的默认view的名字是Event Timeline（开发层：sequential view），另外还有一个 Event Table（table view）和 Event Stats（statistics view）
	- 概念 Concept cluster 记录知识点、工具、科研论文等
		- 默认是timeline view，同时有network、table view
		- *咦，好像多个concept cluster是有意义的？*
		- *concept cluster template* 显然可以进一步细分，比如背单词用一个、PC小工具用一个
	- (extra) 待办事项 Todo cluster
		- 需要kanban view、calendar view、gantt chart view等项目管理类的视图
*（其实很多功能不只是通过一个cluster template来实现的，比如人脉管理用了人和事两个，健身记录需要用健身动作和单次健身等cluster实现）*
*（突然想到可以搞一系列属于整个知识库的 stat panel，可以综合所有cluster的 stat cards）*

*（通过customized cluster templates的概念我们能统一市面上很多笔记软件和tracker软件，由此实现此类功能间的快速跳转）*

那么可以导出什么呢？
不同的view通过复用组件也许可以实现独立于view的theme support
network view需要提供不同的节点风格（显示信息的多少）和布局方式的选择，properties到rendered node's styles 如渲染元素颜色与属性的关系*如何*做到高自由度且高统一性的自定义？
### B. Second use (beginner)

### C. 10th use (a little bit familiar)

### D. 100th use (expert user)
usual habit
小明在长期的使用中已经为知识库创建了多个知识集群

当小明重新到达一个城市、听到一个不熟的朋友的新消息、向朋友介绍之前的某次旅游经历时都会打开jotmind进行搜索，查看所有信息检查有没有自己忘记的有关联的事物：系统会用自然语言

当小明从一次讨论课中了解到一项新的和自己的工作相关的软件框架/专利/论文工作时都可以把相关信息（名称、网址、tag、相关的场合）直接告诉jotmind 对应信息集群的 interface（也可以统一interface？），系统会自动记录下信息

用户可以查看一个瀑布列表按照时间顺序查看添加的内容

用户可以记录自己看书认识的新单词，可以有一个插件是从中出题（类似anki的卡片式，或者[notability的](https://www.xiaohongshu.com/explore/672b12a2000000001b01223a?xsec_token=AB7de2teuqkXJCBDGKKgwtlO9YzoA7K1jR7k4BsXDCkCs=)）

深度用户可以选择每日标记自己的行程（类似ManicTime）（这个可以通过从日历导入+微调实现）（甚至可以添加gps、strava、交通方式等行程数据），系统会自动将“在这个时间段中添加的知识项”和该行程创建连接，以此记录“该信息是我在......过程中创建的”

一个可能的自定义插件：健身追踪，参考 [Strong](https://www.strong.app/)
包含下列richnode：
- （一次）健身-继承于-事件
	- 子节点：做一次某个健身动作
		- 子节点：做一组某个健身动作
继承于事件意味着可以添加同行人和其他体验笔记
添加“timeline view”上的健身节点component，加上一些按钮和input field记录组数/重量
添加statistics view上的configuration，按时间呈现健身情况的一些统计信息
- 健身动作-继承于-概念
	- 添加一些 static node，包括一些介绍动图


参考 [Clay: A Day in the Life](https://library.clay.earth/hc/en-us/articles/6820587714459-A-Day-in-the-Life)

core:
- add a note to somebody（在jotmind中这些note会被加入到ai search的context中）
- search who I can meet when I plan to go somewhere
- 快捷地添加群组
	- 实际上 tag、group、包含某个相同的属性这些都可以被视为群组

拓展：Reconnect suggestions (clay)
纪念日等 remind component （这些有side-effect比如闹钟提醒的组件也可以作为节点整合到database中啊）


view:
一般一个view仅显示一个cluster内的节点，淡化inter-cluster connections（点击那些部分可以跳转目标cluster的default view）
基本视图：
- network view (abbr. net)
	- 自定义部分：jmfNetNode、jmfNetEdge、jmfNetRenderController
		- renderController控制cluster内哪些jmbNode/jmbEdge要被渲染（以及是否需要合并等操作
		- 前端的node、edge类还需要处理各种交互操作，和后端通信
- sequential view (timeline) (abbr. seq)
	- 自定义部分：jmfSeqCard、jmfSeqRenderController
	- card需要处理交互操作
- table view (abbr. tab)
	- 自定义部分：jmfTabEntry、jmfTabRenderController
	- jmfTabEntry对应表格内每个格子的富文本组件（比如胶囊形状的tag）
- statistics view (abbr. stat)
	- 自定义部分：jmfStatCard、jmfStatRenderController
	- card需要处理交互操作
扩展视图
- Kanban view
- Calendar view

cluster template:
指示某类节点如何渲染和显示
包含：
后端
jmbNode/Edge的default properties（还有edge双边的连接jmbNode Type）
与此相关的编辑/搜索 parser 的rag自定义参数
自定义crawler（添加人物节点自动爬取instagram头像、添加小工具对应的网址自动爬取预览，类似telegram）

前端
- 各个view的渲染配置（如何从jmbNode/Edge到jmfNode/Edge---Render Controllers）
	- 内置StatCard config
	- netNode 可以添加自己的按钮、输入框等
- 默认的view，和请求查看某个properties时该打开默认view的哪个界面

module
包括多个cluster template和自定义的View和static node/edge，其中的cluster template可以相互依赖，不过不同module中的cluster template不能双向依赖

由此，

后端：
- jmbNode/Edge和底层数据库的沟通
- RAG查询

前端：
- 登录界面、导航栏（视图的切换）
- 挂载多个module

抽象出一个操作序列，由此可以实现教程？



## Step 4: List the user stories to support the scenarios:
> Based on the scenarios, decide on the user stories you need to support. For example, based on the scenario 'A. First use', you might have user stories such as these:



---

| Questions                                                                                                                | Answer                                                                                                                                                          |     |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| Can multiple clusters of the same template coexist meaningfully (e.g., multiple concept clusters for different domains)? | 不可以，这样会产生多余的inter-cluster links，不同domains的concept可以通过在唯一的concept cluster中添加不同的tag区分，在view中通过filter功能缩小可视化范围                                                     |     |
| Should users be able to create or customize cluster templates? How is validation handled?                                | 目前我们不计划让普通用户在app层面自定义cluster template，后续会提供开发者接口，validation方式暂未确定                                                                                               |     |
| Should views support limited rendering of inter-cluster connections (e.g., via ghost nodes or jump links)?               | 你说的对，这是可以的，不同的view可以自己决定inter-cluster link的呈现方式                                                                                                                 |     |
| Should LLM parsing output follow a strict schema? How are conflicting or vague interpretations resolved?                 | 是的，llm parsing output 应该遵循一个严格的json schema，目前我们计划简单地直接丢弃不符合要求的输出项，fallback是简单的全文搜索（所有这些不同的interpretation，包括“全文搜索”，都会列在搜索栏旁供用户确认）                                |     |
| How will themes and style customizations be managed across views while preserving component reusability?                 | 对每一个cluster我们会设计一套统一的visualization component（如详细、粗略的“卡片 Card component”和“节点”component），所有这几套component都继承于一个统一的 base component family，使单个view的代码可以复用于渲染不同cluster |     |
| How deeply should full-text or attribute search traverse the graph (single cluster vs. entire knowledge base)?           | 不同的搜索指令有不同的搜索范围，这也是llm parsing output's json schema的一个 field                                                                                                    |     |
| Are static nodes (like predefined exercises or vocabulary) globally accessible or cluster-local?                         | 既然我们的cluster都为singleton，static node 只是 pre-defined read-only node，访问方式和其他node没有区别                                                                               |     |
| How should modules/plugins be published, shared, or imported by end users?                                               | 目前初步阶段我们计划hardcoded modules，直到系统稳定后再加入module controller                                                                                                         |     |
