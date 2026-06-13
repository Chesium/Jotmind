Node
Label 节点类型 css class
Relationship 有 type 和 direction
Properties

核心查询语法 `match`（指令不区分大小写?）：
```cypher
match (u:LabelA)-[r:RelationType]->(v:LabelB)
where u.PropA = "..."
return u, r, v
order by ...
```

其中 `u, r, v` 是变量variables

match 关系方向可以反向：`match (...)<-[...]-(...)`
如果不明确用`<`或`>`点出关系方向，系统默认方向是向右
可以组合：`match ()-[]->()<-[]-()`

`where`

`or`
`2000<=...<=2003`
`m.propC is not null` 该属性存在
`starts with` / `ends with` / `contains` 字符串搜索
可以使用 `toLower(p.name)` 预处理数据
`exists(()-[]->())` / `not exists(()-[]->())` 检查关系
`p.born in [..., ..., ...]` 包含于


返回表格数据：`return u.propA, r.propB, v.propC`
更改返回数据别名：`return ... as ABC, ... as DEF`

核心修改语法`merge`
使用`create` 跳过预查找阶段，可能会创建多个具有相同属性的节点

```cypher
merge (u:L {propA:"..."})-[r:R {propB:"..."}->(...)]
merge ...
...
set u.propC = ...
return u,r,...
```

`set u.propA = ...` 创建或更新属性
`set u:LabelB` 新增label
`remove u.propA`或`set u.propA = null` 移除属性，不应该移除 primaty properties

```cypher
merge (...)
on create set p.createAt = datetime()
on match set p.updatedAt = datetime()
set p.propA= ...
return ...
```

使用 `on match` / `on create` 来条件式更新节点属性（创建时 / 更新时）

`merge` 会尝试在pattern整个不存在的情况下创建，如果只有部分存在会报错，因此最好分开创建节点和关系

`delete` 删除关系和没有任何现存relationship的节点
`detach delete` 会首先删除连接该节点的关系然后删除节点

```cypher
match (n)
detach delete n
```

上述代码会清空数据库


data model (meta graph) --- instance model (小规模实例)

- defining labels
	- dominant entities
	- nouns in use cases
- node properties
	- identifying node (unique identifier)
	- anchor of queries
- relationships
	- verbs in use cases

fanout?

limit number of labels per node to 4

`UNWIND m.languages AS language` 拓展接下来的语句，相当于为遍历列表属性 `m.language`，循环变量为`language`

```cypher
MATCH (n:Actor)-[:ACTED_IN]->(m:Movie)
CALL apoc.merge.relationship(n,
	'ACTED_IN_' + left(m.released,4),
	{}, {}, m , {} )
YIELD rel
RETURN count(*) AS `Number of relationships merged`
```

The Cypher code above specializes a relationship: `ACTED_IN` → `ACTED_IN_1995` and more
