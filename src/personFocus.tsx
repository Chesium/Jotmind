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
import useUndo from './lib/use-undo';
import {Undo, Redo, Plus} from 'lucide-react-native';

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
  const [
    dataPropState,
    {
      set: setDataProp,
      reset: resetDataProp,
      undo: undoDataProp,
      redo: redoDataProp,
      canUndo,
      canRedo,
    },
  ] = useUndo<Properties>({});
  const [data, setData] = useState<PersonNodeData>(emptyPersonNodeData);
  // const [dataProp, setDataProp] = useState<Properties>({});
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  const {present: dataProp} = dataPropState;
  useEffect(() => {
    // navigation.addListener('beforeRemove', async e => {
    //   await route.params.session?.close();
    // });
    async function initData() {
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
        setDataProp(queryResult.properties);
      }
    }
    async function updateData(newProp: Properties) {
      if (route.params.session == null) {
        return;
      }
      console.log('update data');
      console.log(dataProp);
      updateNodeProperties(
        route.params.session,
        route.params.elementId,
        newProp,
      );
      // await fetchData();
      setData({...data, properties: {...newProp}});
    }
    if (Object.keys(dataProp).length == 0) {
      //init
      initData();
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
      <View style={style.propertiesEditorToolbar}>
        <Undo
          style={style.undo}
          size={20}
          color={dataPropState.past.length > 1 ? '#666666' : '#cccccc'}
          onPress={e => {
            if (dataPropState.past.length > 1) {
              undoDataProp();
            }
          }}
        />
        <Redo
          style={style.redo}
          size={20}
          color={canRedo ? '#666666' : '#cccccc'}
          onPress={redoDataProp}
        />
        <Plus
          style={style.plus}
          size={20}
          color="#666666"
          onPress={e => {
            var i = 1;
            while (dataProp[`newProp${i}`] !== undefined) {
              i++;
            }
            var nprop: Properties = {};
            nprop[`newProp${i}`] = '';
            setDataProp(Object.assign({...nprop}, dataProp));
          }}
        />
      </View>
      <PropertiesEditor
        data={data}
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
    paddingVertical: 15,
  },
  propertiesEditorToolbar: {
    paddingVertical: 10,
    width: 330,
    justifyContent: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  undo: {
    // marginRight:"auto",
  },
  redo: {
    // marginRight:"auto",
  },
  plus: {
    marginLeft: 'auto',
  },
});
