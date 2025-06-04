import * as React from 'react';
import {Text, View, Image, StyleSheet, ScrollView} from 'react-native';
import type {expandedNodeData, TagData, neo4jLoginInfo} from './dataType';
import PersonCard, {OnFocus} from './personCard';
import {connectToNeo4j, retrieveInfo, retrieveEdgeInfo} from './neo4jconnector';
import {
  createStaticNavigation,
  StaticParamList,
  StaticScreenProps,
  useNavigation,
} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Button} from '@react-navigation/elements';
import {PersonFocus} from './personFocus';
import {Driver,Session} from 'neo4j-driver';

export default function PersonCardView({
  data,
  onFocus,
}: {
  data: expandedNodeData[];
  onFocus: OnFocus;
}) {
  return (
    <ScrollView contentContainerStyle={style.scrollContainer}>
      {data.map((nodeData, i) => (
        <PersonCard
          data={nodeData}
          key={`PersonCard${i}`}
          onFocus={onFocus}></PersonCard>
      ))}
    </ScrollView>
  );
}

export type PersonCardViewFromNeo4jProps = StaticScreenProps<{
  neo4jinfo: neo4jLoginInfo;
}>;

export function PersonCardViewFromNeo4j({route}: PersonCardViewFromNeo4jProps) {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  var [driver, setDriver] = React.useState<Driver | null>(null);
  var [data, setdata] = React.useState<expandedNodeData[]>([]);

  React.useEffect(() => {
    async function init() {
      var myDriver = await connectToNeo4j(route.params.neo4jinfo);
      setDriver(myDriver);
      var nodelist = (await retrieveInfo(myDriver)) as expandedNodeData[];
      console.log(nodelist);
      setdata(nodelist);
    }

    if (data.length == 0) {
      // actually it will only run once
      init();
    }
  }, []);

  return (
    <PersonCardView
      data={data}
      onFocus={neo4jId => {
        navigation.navigate('Focus', {session: driver?.session(), elementId: neo4jId});
      }}></PersonCardView>
  );
}

export const CardStack = createNativeStackNavigator({
  screens: {
    Cards: {
      screen: PersonCardViewFromNeo4j,
      options: {
        headerBackTitle: 'Cards',
      },
      initialParams: {
        neo4jinfo: {
          url: 'neo4j+s://88964078.databases.neo4j.io',
          username: 'neo4j',
          password: 'dwYzcQjWVcdltn3CuFjXOOlexAqucW51BTEHCmm7llg',
        },
      },
    },
    Focus: PersonFocus,
  },
});

type CardStackParamList = StaticParamList<typeof CardStack>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends CardStackParamList {}
  }
}

// export const CardStackNavigation = createStaticNavigation(CardStack);

const style = StyleSheet.create({
  scrollContainer: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 20,
  },
});
