import * as React from 'react';
import {Text, View, Image, StyleSheet,ScrollView} from 'react-native';
import type {expandedNodeData, TagData, neo4jLoginInfo} from './dataType';
import PersonCard from './personCard';
import { connectToNeo4j, retrieveInfo, retrieveEdgeInfo } from './neo4jconnector'

export default function PersonCardView({data}:{data:expandedNodeData[]}){
    return (
        <ScrollView contentContainerStyle={style.scrollContainer}>
            {data.map((nodeData,i) =>
                <PersonCard data={nodeData} key={`PersonCard${i}`}></PersonCard>
            )}
        </ScrollView>
    );
}

export function PersonCardViewFromNeo4j({neo4jinfo}:{neo4jinfo:neo4jLoginInfo}){
    var [data,setdata]=React.useState<expandedNodeData[]>([]);

    React.useEffect(()=>{
        async function init(){
            var driver = await connectToNeo4j(neo4jinfo);
            var nodelist = (await retrieveInfo(driver)) as expandedNodeData[];
            console.log(nodelist);
            setdata(nodelist);
        }

        if(data.length==0){ // actually it will only run once
            init();
        }
    },[])

    return (
        <PersonCardView data={data}></PersonCardView>
    );
}

const style = StyleSheet.create({
    scrollContainer : {
        paddingVertical:20,
        alignItems: 'center',
        gap:20
    }
});