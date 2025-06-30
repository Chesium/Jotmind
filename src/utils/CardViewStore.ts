import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { EdgeData, Neo4jId, PersonNodeData, PersonNodeMap, Properties } from "./dataType";

import { Neo4jConnector } from "./neo4juserCtrl";

type UpdateNodeRecord = {
    type: "UpdateNode";
    oldNode: PersonNodeData;
    newNode: PersonNodeData;
};

type UpdatePropRecord = {
    type: "UpdateProp";
    id: Neo4jId;
    oldProp: Properties;
    newProp: Properties;
};

type UpdateRecord = UpdateNodeRecord | UpdatePropRecord;

interface CardViewState {
    actionHistoryPast: UpdateRecord[];
    actionHistoryFuture: UpdateRecord[];
    map: PersonNodeMap;
    graphEdges: EdgeData[];
    fetchMap: (connector: Neo4jConnector) => Promise<void>;
    syncUpdates: (connector: Neo4jConnector, callback: (rest: number, total: number) => void) => Promise<void>;

    undo: () => void;
    redo: () => void;

    updateNode: (newNode: PersonNodeData) => void;
    updateProp: (id: Neo4jId, nprop: Properties) => void;
}

const dcopy = (o: any) => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
export const deepCmp = <T>(o: T, n: T) =>
    JSON.stringify((o as any).map) == JSON.stringify((n as any).map)

const useCardViewStore = create<CardViewState>()(
    immer(
        (set, get) => {
            return {
                actionHistoryPast: [],
                actionHistoryFuture: [],
                map: {},
                graphEdges: [],
                fetchMap: async (connector) => {
                    console.log("begin fetching PersonNodeMap from Neo4j");
                    set({
                        actionHistoryPast: [],
                        actionHistoryFuture: [],
                        map: await connector.retrieveInfoAsMap(),
                        graphEdges: await connector.retrieveEdgeInfo()
                    });
                },
                syncUpdates: async (connector, callback: (rest: number, total: number) => void) => {
                    const { map, actionHistoryPast } = get();
                    const itemN = actionHistoryPast.length;
                    const affectedNodeIDs = new Set(actionHistoryPast.filter((h) => h.type == "UpdateProp").map((h) => h.id));
                    connector.updateNodeProperties(Array.from(affectedNodeIDs.values()).map((id) => { return { id: id, newProp: map[id].properties } })).then(() => { console.log("Update Done"); });
                    // for (var i = 0; i < itemN; i++) {
                    //     callback(itemN - i, itemN);
                    //     let action = actionHistoryPast[i]
                    //     if (action.type == 'UpdateProp') {
                    //         await connector.updateNodeProperties(action.id, action.newProp)
                    //     } else {

                    //     }
                    // }
                    set(state => {
                        state.actionHistoryPast = [];
                        state.actionHistoryFuture = [];
                    })
                },

                undo: () => {
                    set((state) => {
                        var action = state.actionHistoryPast.pop();
                        if (action !== undefined) {
                            state.actionHistoryFuture.push(dcopy(action));
                            if (action.type == "UpdateNode") {
                                let id = action.newNode.elementId;
                                state.map[id] = dcopy(action.oldNode);
                            } else {
                                // UpdateProp
                                let id = action.id;
                                state.map[id].properties = dcopy(action.oldProp);
                            }
                        }
                    });
                },
                redo: () => {
                    set((state) => {
                        var action = state.actionHistoryFuture.pop();
                        if (action !== undefined) {
                            state.actionHistoryPast.push(dcopy(action));
                            if (action.type == "UpdateNode") {
                                let id = action.newNode.elementId;
                                state.map[id] = dcopy(action.newNode);
                            } else {
                                // UpdateProp
                                let id = action.id;
                                state.map[id].properties = dcopy(action.newProp);
                            }
                        }
                    });
                },
                updateNode: (newNode) => {
                    // console.log("updateNode"), console.log(newNode);
                    set((state) => {
                        var id = newNode.elementId;
                        state.actionHistoryPast.push({
                            type: "UpdateNode",
                            oldNode: dcopy(id in state.map ? state.map[id] : undefined),
                            newNode: dcopy(newNode),
                        });
                        state.actionHistoryFuture = [];
                        state.map[id] = dcopy(newNode);
                    });
                },
                updateProp: (id, nprop) => {
                    console.log("updateProp"), console.log([id, nprop]);
                    set((state) => {
                        state.actionHistoryPast.push({
                            type: "UpdateProp",
                            id: id,
                            oldProp: dcopy(state.map[id].properties),
                            newProp: dcopy(nprop),
                        });
                        state.actionHistoryFuture = [];
                        state.map[id].properties = dcopy(nprop);
                    });
                },
                // set((state) => ({
                //   updateHistory: state.updateHistory,
                //   map: { ...state.map, [id]: { ...state.map[id], properties: nprop } },
                // })),
            };
        }
        // {
        //   partialize: (state) => {
        //     const { updateHistory, map, ...rest } = state;
        //     return { updateHistory, map };
        //   },
        // }
    )
);

// middleware(useCardViewStore, "CardView");


// export default function useCardViewStoreMod<T>(selector:(state:CardViewState)=>T){
//     return useCardViewStore(selector,(n))
// }

export default useCardViewStore;