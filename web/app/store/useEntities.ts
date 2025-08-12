import { create } from "zustand"
import { ZResAll, type Claim, type Entity, toNodeType, type UpdateData } from "@my-repo/shared-types";
import { indexByTo } from "../utils";
import { api } from "../lib/auth-client";
import { immer } from 'zustand/middleware/immer'
import MiniSearch, { type Suggestion } from 'minisearch'

interface Doc extends Entity {
  predicates: string;
  claimDesc: string;
  claimValues: string;
  nxtNames: string;
}

interface State {
  initialized: boolean;
  loading: boolean;
  entitiesMap: Record<string, Entity>;
  claimsMap: Record<string, Claim>;
  entityClaims: Record<string, string[]>;
  docs: Record<string, Doc>;
  miniSearchIdx: MiniSearch<Doc>;
  /* FullText Search */
  query: string;
  displayedIdx: string[];
  suggestions: Suggestion[];

  // entities: Entity[];
  // selected?: Entity;
  // claimsByEntity: Record<string, Claim[]>;
  fetchAll: () => Promise<void>;
  updateEntity: (data: UpdateData, sync?: boolean) => Promise<void>;

  setQuery: (q: string) => void;
  runSearch: () => void;

  // search: () => Promise<void>;
  // loadOverview: (uuid: string) => Promise<void>;
  // createClaim: (dto: any) => Promise<void>;
  // deleteClaim: (uuid: string) => Promise<void>;
};

const _idxFields = [
  "name",
  "description",
  "predicates",
  "claimDesc",
  "claimValues",
  "nxtNames",
]

function initIndex(): MiniSearch<Doc> {
  return new MiniSearch({
    idField: "uuid",
    fields: _idxFields,
    storeFields: ["uuid"],
    searchOptions: {
      boost: { name: 3, predicates: 1.5, description: 1, claimDesc: 1, claimValues: 2, nxtNames: 1.2 }
    }
  })
}

function toDoc(
  uuid: string,
  emap: Record<string, Entity>,
  cmap: Record<string, Claim>,
  cofe: Record<string, string[]>
): Doc {
  const claims = cofe[uuid].map(cid => cmap[cid]);
  const predicates = claims.map(claim => claim.predicate).join(' ');
  const claimDesc = claims.map(claim => claim.description).join(' ');
  const claimValues = claims.map(claim => claim.value_str).join(' ');
  const nxtNames = claims.map(claim =>
    claim.args.map(arg => emap[arg.node_uuid].name)).flat().join(' ');
  return { ...emap[uuid], predicates, claimDesc, claimValues, nxtNames };
}

export const useEntities = create<State>()(immer((set) => ({
  initialized: false,
  query: "",
  loading: false,
  entitiesMap: {},
  claimsMap: {},
  entityClaims: {},
  docs: {},
  displayedIdx: [],
  miniSearchIdx: initIndex(),
  suggestions: [],
  // entities: [],
  // claimsByEntity: {},
  fetchAll: async () => {
    set({ loading: true });
    const data = ZResAll.parse(await api<null, any>("/api/fetchall"))
    console.log(data);
    // const claims = data.map((item) => { return { entity_uuid: item.entity.uuid, claim_ids: item.claims.map(c => c.claim_uuid) } })
    const emap = indexByTo(data.entities, (e) => e.uuid, (i) => { return { ...i, type: toNodeType(i.labels[0]) } })
    const cmap: Record<string, Claim> = indexByTo(data.claims, (e) => e.uuid, (i) => i)
    // const cmap = indexByTo(data.map((item) => item.claims).flat(), (c) => c.claim_uuid, (c) => c)
    const uuids = data.entities.map(item => item.uuid);
    const cofe: Record<string, string[]> = Object.fromEntries(uuids.map(uuid => [uuid, []]))
    Object.values(cmap).forEach(claim => {
      claim.args.forEach(arg => {
        cofe[arg.node_uuid].push(claim.uuid!);
      })
    })
    const idx = initIndex();
    const docs = uuids.map(uuid => toDoc(uuid, emap, cmap, cofe))
    const docsMap = indexByTo(docs, (d) => d.uuid!, (d) => d);
    idx.addAll(docs);
    console.log("docs: ", docs);
    set({
      initialized: true,
      docs: docsMap,
      entitiesMap: emap,
      entityClaims: cofe,
      claimsMap: cmap,
      displayedIdx: uuids,
      loading: false,
      miniSearchIdx: idx,
    });
  },
  updateEntity: async (data, sync = true) => {
    set(s => {
      s.entitiesMap[data.entity.uuid] = data.entity
      if (data.entity.uuid in s.entityClaims) {
        s.entityClaims[data.entity.uuid].forEach(cid => {
          delete s.claimsMap[cid]
        })
      }
      data.claims.forEach(claim => {
        s.claimsMap[claim.uuid] = claim
      })
      // state.entityClaims[data.entity.uuid] = data.claims.map(claim => claim.uuid)
      const uuids = Object.keys(s.entitiesMap);
      const cofe: Record<string, string[]> = Object.fromEntries(uuids.map(uuid => [uuid, []]))
      Object.values(s.claimsMap).forEach(claim => {
        claim.args.forEach(arg => {
          cofe[arg.node_uuid].push(claim.uuid!);
        })
      })
      s.entityClaims = cofe
      // TODO other entities with relevant claims updated will not be affected
      if (data.entity.uuid in s.docs) s.miniSearchIdx.remove(s.docs[data.entity.uuid]);
      const newDoc = toDoc(data.entity.uuid, s.entitiesMap, s.claimsMap, cofe);
      s.miniSearchIdx.add(newDoc);
      s.docs[data.entity.uuid] = newDoc;
      // state.miniSearchIdx.replace(toDoc(data.entity.uuid, state.entitiesMap, state.claimsMap, cofe))
    })
    if (sync) {
      await api<UpdateData, null>("/api/update", { method: "POST", body: data })
      console.log("update done");
    }
  },
  setQuery: (q) => {
    set(s => {
      s.suggestions = q ? s.miniSearchIdx.autoSuggest(q) : [];
      s.query = q;
    })
  },
  runSearch: () => {
    set(s => {
      if (!s.query.trim()) {
        s.displayedIdx = Object.keys(s.entitiesMap); // display all entities when the query is empty
      } else {
        console.log("runSearch: ", s.query);
        const hits = s.miniSearchIdx.search(s.query)
        console.log("hits: ", hits);
        s.displayedIdx = hits.map(hit => hit.id);
      }
    })
  },
  // search: async () => {
  //   set({ loading: true });
  //   const res = await fetch(`/api/entities?query=${encodeURIComponent(get().query)}`);
  //   const data = await res.json();
  //   set({ entities: data, loading: false });
  // },
  // loadOverview: async (uuid) => {
  //   const res = await fetch(`/api/entity/${uuid}/overview`);
  //   const data = await res.json();
  //   set(state => ({ selected: data.entity, claimsByEntity: { ...state.claimsByEntity, [uuid]: data.claims } }));
  // },
  // createClaim: async (dto) => {
  //   await fetch(`/api/claim/create`, { method: "POST", headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dto) });
  //   // 简单做法：刷新选中实体概览
  //   const sel = get().selected; if (sel) await get().loadOverview(sel.uuid);
  // },
  // deleteClaim: async (cid) => {
  //   await fetch(`/api/claim/${cid}`, { method: "DELETE" });
  //   const sel = get().selected; if (sel) await get().loadOverview(sel.uuid);
  // }
})));