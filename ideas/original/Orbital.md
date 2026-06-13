[[Frontend]]
[[Neo4j]]
[[User Stories]]
[[JotMind Stack]]
[[NestJS]]
[[LangChain]]
[[relanote]]

[TypeError: fetch failed when starting Expo project](https://github.com/expo/expo/issues/33051)
[Error: Failed to install react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto/issues/333)

可以作为 PRM（personal relationships management），见[[MonicaHQ]]


- 
- 人
	- 认识的事件
		- 事件可以包含？“我在某个场合认识了好几个人”
	- 名字：主名、别名（列表）
		- →得知其中一个别名的事件
			- 默认主名在“认识”事件中得知
	- 生日：确定、不确定（范围）
	- 各种知道的信息（属性名可选-值/信息-知道的事件）
	- 标签/分组
	- 和其他人的关系
- 标签/分组
- 关系
	- 分组推导出关系（图数据库可解决）
	- 关系推导出关系（图数据库可解决）
	- 知道存在此关系的事件
- 事件
	- 参与人员
	- 包含在某一事件
	- 标签/分组
	- 备注
	- 时间：确定、不确定
	- 地点

日记
- 可以自己添加文字属性节点（interface-like）
	- eg uniqueness / Done / Explored & Learned / Misc
- 事件列表

“之一”节点

this is a formula $e^{x}$

![](Orbital-20250812163434495.png)


## TechStack
跨平台支持：React + Ionic
数据库：

[react+ionic+gundb](https://freedium.cfd/https://javascript.plainenglish.io/ionic-gunjs-build-a-dapp-using-a-decentralised-db-in-your-ionic-app-4cbb5325b63e)
## Intro
[[relanote]]
我想要开发一款跨平台笔记软件Jotmind用于快速记录生活中的各种同类概念、其属性和对象之间的关系，并可以对这些关系设置逻辑推导规则，实现prolog式的关系搜索

- 比如用户可以利用这个软件在阅读人物关系复杂的文学作品（如《红楼梦》）的过程中同步记录人物角色、角色的特点和属性、角色之间的关系和与角色相关的情节，这里就可以利用逻辑推理功能来实现复杂亲属关系的快速查询。

- 这个笔记平台有一个核心概念是概念模板，相当于一个接口，方便用户快速地录入信息，比如上述“同步阅读笔记”应用场景中“人物角色”就是一个概念模板，当用户阅读中遇到一个新角色而在系统中创建新的角色概念时，这个新角色便默认拥有这些属性以供用户填写，这些属性也分属于不同数据类型，有对应的处理规则，比如“年龄”对应的单位可以是一个具体的年数，也可以与另一个“日期”量相关，如“角色A在X事件发生后的第二个春天出生”

- 对于前端，为了实现高效的数据录入，不同的应用场景可能需要不同的前端模块，这里的前端包含不同的界面可以以不同方式实现用户对数据库的编辑、修改和可视化查看

- 对于上面的例子“阅读笔记场景”，核心的前端组件是一个交互式人物关系图模块，可以清晰地显示人物之间的关系和其他自定义属性（如节点的颜色、大小、内部文字的含义均可以自定义），点击节点可以查看/编辑详细的角色属性，同时选中两个角色可以添加角色关系，同时选中多个角色可以添加分组或标签，这个分组和标签也可能与某些规则集相关（如“同属一个班级”可以推出班级中的同学“互相认识”）

- 在另外一些场景中，比如“零碎任务规划场景”里，用户平常记录自己零碎的任务，标记重要性、分类和关键时间并后续将这些任务规划到自己的时间表里，这时除了按照概念模板录入任务的常规前端组件外，还有一个任务列表-日程表组件，其中用户可以通过拖动的方式将任务分配到时间表里，在这个过程中系统会自动录入时间安排信息并处理规则操作（如时间冲突处理、依赖关系处理）等

- 用户可以采用不同“应用场景模板”，每个场景对应一系列概念模板、规则集和前端套件，这可以自己制作，也可以打包和其他用户分享

- 平台开放插件接口，上述所有前端组件都以插件的形式进行管理，插件可以查看、修改数据库中的信息，这个权限平台进行管理

- 主搜索界面作为默认搜索前端组件之一支持不同程度的模糊搜索和自然语言识别，可以将自然语言转化为系统能识别的搜索语句并加以搜索，力求做到用户操作的流畅性

对于上述的软件想法，请你给出一个大致的系统架构和技术栈，并提出其中的一些技术难点和可能的实现方法



## motivation
- 读书笔记：人物关系复杂、读完后容易遗忘、手工制作人物关系图费时费力，没有快捷的查询方法，现有的思维导图软件缺少处理复杂关系网的能力
- 现实人际关系梳理：进入大学，社交圈多样复杂，容易遗忘
## Aim
- 实现快捷的信息录入以及查询、可视化、多类型数据导出和分享
	- 快捷：适配的前端，支持模糊搜索和联想和（筛选）
- 实现复杂对象关系网中逻辑关系的推导和查询
- 数据开放平台，支持其他开发者进行二次开发（前端）
## User stories

**

[Please describe what the users would be able to do with your system.]
1. 
2. As [a particular user group] who wants to [achieve a particular objective], I want to be able to [perform a task in the system].

记录碎片化信息，并加以搜索

- Reader - 梳理复杂的角色关系 - 记录角色第一处出现的页数、角色之间以及角色与情节之间的关系、角色的其他属性（年龄、性格）
- Stock Analyst - 记录有关市场行情、国际新闻和相关股票、基金、货品、虚拟货币等等等价格的关系 - 记录.......
- President of the SU - 梳理复杂的人物关系/任务 - 快速，活动的进度、相关issue、负责人、开会相关的日程
- a class Head teacher in Secondary school - 学生的日常学习状况、家长的反馈
- vlogger / content creator - 记录生活/旅途中的琐碎小事并进行归纳（比如串联出不同的主线）以便于视频剪辑、文章写作
- Editor (文学)审稿人 - 检查逻辑关系
## Features
- 和外部照片、视频、文档等归档数据库联动，双向引用
## Timeline
## Tech Stack


[Linkurious](https://linkurio.us/)
做经济犯罪侦查

![[Pasted image 20250328183015.png|649]]


**Heptabase** "学习软件"
嵌套白板-文本知识链接
Timeline 快速记录
tags 初步整理
![[Pasted image 20250328184330.png|468]]




