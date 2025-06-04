import {Session} from 'neo4j-driver';
import type {expandedNodeData, Neo4jId} from './dataType';
import {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import PersonCard from './personCard';
import {
  PropertiesEditor,
  type Properties,
} from './propertyEditor/PropertiesEditor';
import {
  PersonNodeDataToCy,
  testTagSignature,
  type PersonNodeData,
  getNodeByElementId,
  updateNodeProperties,
} from './neo4jconnector';
import {StaticScreenProps, useNavigation} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

export type PersonFocusProps = StaticScreenProps<{
  session: Session | null;
  elementId: Neo4jId;
}>;

export function PersonFocus({route}: PersonFocusProps) {
  var emptyPersonNodeData: PersonNodeData = {
    identity: 0,
    labels: [],
    properties: {},
    elementId: '',
  };
  const [data, setData] = useState<PersonNodeData>(emptyPersonNodeData);
  const [dataProp, setDataProp] = useState<Properties>({});
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  useEffect(() => {
    // navigation.addListener('beforeRemove', async e => {
    //   await route.params.session?.close();
    // });
    async function fetchData() {
      if (route.params.session == null) {
        return;
      }
      console.log('fetch data');
      var queryResult = await getNodeByElementId(
        route.params.session,
        route.params.elementId,
      );
      console.log('getNodeByElementId result');
      console.log(queryResult);
      if (queryResult !== null) {
        setData(queryResult);
      }
    }
    async function updateData(newProp: Properties) {
      if (route.params.session == null) {
        return;
      }
      console.log('update data');
      await updateNodeProperties(
        route.params.session,
        route.params.elementId,
        newProp,
      );
      await fetchData();
    }
    if (Object.keys(dataProp).length == 0) {
      //init
      fetchData();
    } else {
      //update
      updateData(dataProp);
    }
  }, [dataProp]);

  return (
    <ScrollView contentContainerStyle={style.personFocus}>
      <PersonCard
        data={
          PersonNodeDataToCy(
            data,
            testTagSignature,
            'expanded',
          ) as expandedNodeData
        }
        onFocus={e => {}}></PersonCard>
      <PropertiesEditor
        properties={data.properties}
        onChangeProperty={(o, n) => {
          setDataProp(n);
          console.log(n);
        }}
        onSetPropertyKey={(o, n) => {
          console.log(`change key: ${o}=>${n}`);
        }}
        onSetPropertyValue={(k, v) => {
          console.log(`change value: Prop[${k}]<-${v}`);
        }}></PropertiesEditor>
    </ScrollView>
  );
}

const style = StyleSheet.create({
  personFocus: {
    alignItems: 'center',
  },
});
