import { Session } from "neo4j-driver";
import { Neo4jId, Properties } from "./dataType";
import { PersonNodeData, PersonNodeMap, retrieveInfoAsMap, updateNodeProperties } from "./neo4jconnector";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";

import { shallow } from 'zustand/vanilla/shallow'

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
    fetchMap: (session: Session) => void;
    syncUpdates: (session: Session, callback: (rest: number, total: number) => void) => void;

    undo: () => void;
    redo: () => void;

    updateNode: (newNode: PersonNodeData) => void;
    updateProp: (id: Neo4jId, nprop: Properties) => void;
}

const dcopy = (o: any) => JSON.parse(JSON.stringify(o));
export const deepCmp = <T>(o: T, n: T) =>
    JSON.stringify((o as any).map) == JSON.stringify((n as any).map)

const useCardViewStore = create<CardViewState>()(
    immer(
        (set, get) => {
            return {
                actionHistoryPast: [],
                actionHistoryFuture: [],
                map: {},
                fetchMap: async (session) => {
                    console.log("begin fetching PersonNodeMap from Neo4j");
                    set({
                        actionHistoryPast: [],
                        actionHistoryFuture: [],
                        map: await retrieveInfoAsMap(session),
                    });
                },
                syncUpdates: async (session, callback: (rest: number, total: number) => void) => {
                    const { actionHistoryPast } = get();
                    const itemN = actionHistoryPast.length;
                    for (var i = 0; i < itemN; i++) {
                        callback(itemN - i, itemN);
                        let action = actionHistoryPast[i]
                        if (action.type == 'UpdateProp') {
                            await updateNodeProperties(session, action.id, action.newProp)
                        } else {

                        }
                    }
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
                            oldNode: dcopy(state.map[id]),
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