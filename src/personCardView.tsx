import * as React from 'react';
import {Text, View, Image, StyleSheet,ScrollView} from 'react-native';
import type {expandedNodeData, TagData} from './dataType';
import PersonCard from './personCard';

export default function PersonCardView({data}:{data:expandedNodeData[]}){
    return (
        <ScrollView contentContainerStyle={style.scrollContainer}>
            {data.map((nodeData,i) =>
                <PersonCard data={nodeData} key={`PersonCard${i}`}></PersonCard>
            )}
        </ScrollView>
    );
}

const style = StyleSheet.create({
    scrollContainer : {
        paddingVertical:20,
        alignItems: 'center',
        gap:20
    }
});