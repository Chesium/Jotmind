## 最小验收清单
- 能创建/查询四类实体（Person/Event/Concept/Place）
- 能创建 `born_in / learned_about / attended / introduced` 的 Claim
- Gallery 搜索实体名；点击进入详情抽屉，列出相关 Claims
- ClaimEditor 支持手动新增/删除
- `/api/ingest/nl`：给一段中文/英文描述，能产出 1–2 条 Claim 并写入
- 所有写操作参数化 Cypher，服务端进行谓词/角色白名单校验
## 数据模型
```
Node< Person | Place | Event | Concept > {
[PK|A]	uuid: string;
[IDX]	name: string;
[IDX]	description: string;
}

Node< Claim > {
[PK|A]	uuid: string;
[IDX]	predicate: string; // PREDICATE
[IDX]	description: string;
[A]	created_at: Date;
	valid_from: Date;
	valid_to: Date;
	confidence: float;
	value_str: string;
}

Edge< ARG > : <Claim> => <Person|Place|Event|Concept> {
	position: integer;
	role: string;
}
```

`[PK]|A`: primary key 主键，自动生成，通过`CALL apoc.create.uuids(1) YIELD uuid AS gen`

`IDX`: full text index 全文索引用于搜索

## Cypher 列表
需要实现对entity和claim的增删改查
### 初始化类
- [x] `constraints`：数据库约束
	- `uuid` 唯一
- [x] `fullTextIndex`：搜索索引
	- entity 的`name`和`description`
	- claim 的`predicate`和`description`
### 编辑类：增/改
- [x] `upsertEntity`：增/改 entity
	- parameters: `label`, `props`
		- 创建实体
	- parameters: `uuid`, `label`, `props`
		- 更新实体 properties
- [x] `upsertClaim`：增/改 claim
	- parameters: `predicate`, `description`, `meta{confidence,valid_from,valid_to,value_str}`, `args[{role,uuid}]`
		- 创建claim
	- parameters: `uuid`, `predicate`,  `description`, `meta{confidence,valid_from,valid_to,value_str}`, `args[{role,uuid}]`
		- 更新claim predicate
		- 更新claim meta
		- 删除原来的args，添加新的args边
### 删除类
- [ ] `deleteEntity`：删除 entity 和有关的 claim
	- parameters: `uuid`
- [ ] `deleteClaim`：删除 claim
	- parameters: `uuid`
### 查找类
- [x] `entityFulltextSearch`：全文搜索，效果一般
	- parameters: `q`, `offset`, `limit`
- [x] `claimFulltextSearch`：全文搜索，效果一般
	- parameters: `q`, `offset`, `limit`
